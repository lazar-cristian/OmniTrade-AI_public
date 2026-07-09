/**
 * =========================================================================
 * OMNITRADE WEB CORE APPLICATION ENGINE
 * Architecture: Vanilla Single Page Application (SPA)
 * =========================================================================
 */

// CONFIGURAZIONE CLIENT SUPABASE (Supporta sia Vite sia caricamento statico in browser)
const SUPABASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
    ? import.meta.env.VITE_SUPABASE_URL
    : (window.__SUPABASE_URL__ || '');
const SUPABASE_ANON_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY)
    ? import.meta.env.VITE_SUPABASE_ANON_KEY
    : (window.__SUPABASE_ANON_KEY__ || '');

let supabase = null;
if (typeof window.supabase !== 'undefined' && SUPABASE_URL) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Inizializzazione Sessione Anonima Automatica al caricamento
async function inizializzaSessioneSicura() {
    if (!supabase) return null;
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        
        if (!session) {
            console.log("[OmniTrade Security] Nessuna sessione attiva. Creazione account anonimo...");
            const { data: anonymousData, error: anonError } = await supabase.auth.signInAnonymously();
            if (anonError) throw anonError;
            return anonymousData.session;
        }
        console.log("[OmniTrade Security] Sessione utente isolata e attiva.");
        return session;
    } catch (err) {
        console.error("[OmniTrade Security Error] Errore nel bootstrap della sessione:", err.message);
        showNotification("Errore di sincronizzazione di sicurezza con il database Cloud.", "error");
        return null;
    }
}

// SINGLE SOURCE OF TRUTH (STATO CENTRALTIZZATO GLOBALE)
const AppState = {
    currentSection: 'dashboard',
    activeTicker: 'NASDAQ:AAPL',
    activeTimeframe: '15',
    portfolioMode: 'real', // Condizioni ammesse: 'real' | 'demo'
    realWallet: { id: null, balance: 25000.00, positions: [] },
    demoWallet: { id: null, balance: 100000.00, trades: [], equity_curve: [100000.00] },
    chartInstance: null, // Riferimento per distruggere/aggiornare Chart.js
    glossaryCache: []    // Ottimizzazione filtraggio locale senza query ridondanti
};

// INITIALIZATION BOOTSTRAPPER
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inizializza la sessione sicura prima di fare qualsiasi query
    await inizializzaSessioneSicura();
    
    // 2. Continua con il caricamento dei componenti e dei grafici...
    initSPARouter();
    initTimeframeControls();
    initTickerInput();
    initPortfolioEngine();
    initDiaryEngine();
    initAICopilot();
    initParticles();
    
    // Primo caricamento e sincronizzazione backend
    loadTradingView(AppState.activeTicker, AppState.activeTimeframe);
    fetchYahooFinanceData(AppState.activeTicker);
    syncDatabaseContext();
});

/**
 * =========================================================================
 * 1. NATIVE SPA ROUTER
 * =========================================================================
 */
function initSPARouter() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = item.getAttribute('data-target');
            
            // Aggiorna stato attivo sulla sidebar UI
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Switch visivo dei blocchi di sezione
            document.querySelectorAll('.app-section').forEach(sec => sec.classList.remove('active'));
            const activeSectionNode = document.getElementById(targetSection);
            if (activeSectionNode) {
                activeSectionNode.classList.add('active');
                AppState.currentSection = targetSection;
                
                // Trigger per ri-renderizzare grafici responsive se necessario
                if (targetSection === 'dashboard') {
                    renderEquityCurve();
                }
            }
        });
    });
}

/**
 * =========================================================================
 * 2. CONTROLLI TOP BAR (TIMEFRAME & DEBOUNCED TICKER)
 * =========================================================================
 */
function initTimeframeControls() {
    const tfButtons = document.querySelectorAll('.tf-btn');
    tfButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tfButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            AppState.activeTimeframe = btn.getAttribute('data-tf');
            loadTradingView(AppState.activeTicker, AppState.activeTimeframe);
            notify('info', `Timeframe operativo modificato: ${AppState.activeTimeframe}`);
        });
    });
}

function initTickerInput() {
    const tickerInput = document.getElementById('ticker-input');
    tickerInput.addEventListener('input', debounce((e) => {
        const cleanValue = e.target.value.trim().toUpperCase();
        if (cleanValue.length >= 2) {
            AppState.activeTicker = cleanValue;
            loadTradingView(AppState.activeTicker, AppState.activeTimeframe);
            fetchYahooFinanceData(AppState.activeTicker);
        }
    }, 600)); // 600ms di ritardo per stabilizzazione digitazione
}

/**
 * =========================================================================
 * 3. SUPABASE DATA LAYERS (CRUD FUNCTIONS)
 * =========================================================================
 */
async function syncDatabaseContext() {
    const dbStatusText = document.getElementById('db-status-text');
    const statusIndicator = document.querySelector('.status-indicator');
    
    if (!supabase) {
        dbStatusText.innerText = "Local Sandbox Mode";
        statusIndicator.style.backgroundColor = "var(--accent-blue)";
        statusIndicator.style.boxShadow = "0 0 8px var(--accent-blue)";
        fallbackSeedMockData();
        return;
    }

    try {
        // Caricamento asincrono parallelo portafoglio reale e demo
        let { data: realData, error: rErr } = await supabase.from('wallet_real').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
        let { data: demoData, error: dErr } = await supabase.from('wallet_demo').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
        
        if (realData) AppState.realWallet = realData;
        if (demoData) AppState.demoWallet = demoData;
        
        // Carica dati esterni aggiuntivi
        await syncDiaryEntries();
        await syncGlossaryEntries();
        
        updateKPI();
        renderPortfolioHistory();
        renderEquityCurve();
    } catch (err) {
        console.error("Connessione Supabase fallita. Switch in local storage.", err);
        fallbackSeedMockData();
    }
}

async function syncDiaryEntries() {
    if (!supabase) return;
    const { data, error } = await supabase.from('diary').select('*').order('created_at', { ascending: false });
    if (data) {
        renderDiaryDOM(data);
    }
}

async function syncGlossaryEntries() {
    if (!supabase) return;
    const { data, error } = await supabase.from('glossary').select('*').order('term', { ascending: true });
    if (data) {
        AppState.glossaryCache = data;
        renderGlossaryDOM(data);
    }
}

function fallbackSeedMockData() {
    // Iniezione di sicurezza dati volatili nel caso manchi Supabase
    AppState.glossaryCache = [
        { term: 'Order Block', definition: 'Zone di prezzo istituzionali ad alta concentrazione di liquidità.', category: 'Price Action' },
        { term: 'Fair Value Gap (FVG)', definition: 'Inefficienza causata da una spinta unidirezionale impulsiva sul mercato.', category: 'Anomalie' },
        { term: 'Risk to Reward (RR)', definition: 'Rapporto proporzionale di convenienza statistica di un trade.', category: 'Risk Management' }
    ];
    renderGlossaryDOM(AppState.glossaryCache);
    updateKPI();
    renderPortfolioHistory();
    renderEquityCurve();
}

/**
 * =========================================================================
 * 4. TRADINGVIEW & YAHOO FINANCE INTEGRATION
 * =========================================================================
 */
function loadTradingView(ticker, timeframe) {
    // Protezione per accertarsi che lo script CDN sia correttamente caricato
    if (typeof TradingView !== 'undefined') {
        new TradingView.widget({
            "autosize": true,
            "symbol": ticker,
            "interval": timeframe,
            "timezone": "Europe/Rome",
            "theme": "dark",
            "style": "1",
            "locale": "it",
            "toolbar_bg": "#0e121a",
            "enable_publishing": false,
            "hide_side_toolbar": false,
            "allow_symbol_change": false,
            "container_id": "tradingview_widget",
            "studies": [
                "RSI@tv-basicstudies",
                "MASimple@tv-basicstudies"
            ]
        });
    }
}

function fetchYahooFinanceData(ticker) {
    // Aggregatore simulato di flussi grezzi Yahoo Finance API per ordini o metriche esterne
    console.log(`[Yahoo Finance API] Caricamento dati per ${ticker}...`);
    setTimeout(() => {
        const mockVolume = (Math.random() * 5000000 + 100000).toFixed(0);
        notify('info', `Dati grezzi Yahoo Finance agganciati per ${ticker}. Volumi: ${parseFloat(mockVolume).toLocaleString()}`);
    }, 800);
}

/**
 * =========================================================================
 * 5. PORTFOLIO ENGINE, STATS & CALCOLI FINANZIARI
 * =========================================================================
 */
function initPortfolioEngine() {
    const btnReal = document.getElementById('btn-mode-real');
    const btnDemo = document.getElementById('btn-mode-demo');
    const form = document.getElementById('portfolio-form');

    btnReal.addEventListener('click', () => {
        AppState.portfolioMode = 'real';
        btnReal.classList.add('active');
        btnDemo.classList.remove('active');
        notify('info', 'Switch eseguito sul Portafoglio Reale.');
        updateKPI();
        renderPortfolioHistory();
        renderEquityCurve();
    });

    btnDemo.addEventListener('click', () => {
        AppState.portfolioMode = 'demo';
        btnDemo.classList.add('active');
        btnReal.classList.remove('active');
        notify('info', 'Switch eseguito sul Portafoglio Demo Virtuale.');
        updateKPI();
        renderPortfolioHistory();
        renderEquityCurve();
    });

    form.addEventListener('submit', handlePortfolioSubmit);
}

async function handlePortfolioSubmit(e) {
    e.preventDefault();
    
    const ticker = document.getElementById('port-ticker').value.trim().toUpperCase();
    const type = document.getElementById('port-type').value;
    const amount = parseFloat(document.getElementById('port-amount').value);
    const currentDate = new Date().toISOString().split('T')[0];

    const newRecord = { ticker, type, amount, date: currentDate };

    if (AppState.portfolioMode === 'real') {
        AppState.realWallet.balance += amount;
        AppState.realWallet.positions.push(newRecord);
        
        if (supabase && AppState.realWallet.id) {
            await supabase.from('wallet_real').update({
                balance: AppState.realWallet.balance,
                positions: AppState.realWallet.positions
            }).eq('id', AppState.realWallet.id);
        }
    } else {
        AppState.demoWallet.balance += amount;
        AppState.demoWallet.trades.push(newRecord);
        // Genera progressione della curva di profitto
        AppState.demoWallet.equity_curve.push(AppState.demoWallet.balance);
        
        if (supabase && AppState.demoWallet.id) {
            await supabase.from('wallet_demo').update({
                balance: AppState.demoWallet.balance,
                trades: AppState.demoWallet.trades,
                equity_curve: AppState.demoWallet.equity_curve
            }).eq('id', AppState.demoWallet.id);
        }
    }

    document.getElementById('portfolio-form').reset();
    notify('success', `Operazione allocata nel wallet: ${ticker} (${type})`);
    updateKPI();
    renderPortfolioHistory();
    renderEquityCurve();
}

function updateKPI() {
    const isReal = AppState.portfolioMode === 'real';
    const activeWallet = isReal ? AppState.realWallet : AppState.demoWallet;
    const transactionList = isReal ? activeWallet.positions : activeWallet.trades;

    // 1. Calcolo Net Equity Totale
    document.getElementById('kpi-equity').innerText = `€${activeWallet.balance.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // 2. Calcolo P/L Netto e Win Rate
    let netPL = 0;
    let winningTradesCount = 0;
    let totalWinsValue = 0;
    let totalLossesValue = 0;

    transactionList.forEach(t => {
        netPL += t.amount;
        if (t.amount > 0) {
            winningTradesCount++;
            totalWinsValue += t.amount;
        } else {
            totalLossesValue += Math.abs(t.amount);
        }
    });

    const plContainer = document.getElementById('kpi-pl');
    plContainer.innerText = (netPL >= 0 ? '+' : '') + `€${netPL.toFixed(2)}`;
    plContainer.className = `value ${netPL >= 0 ? 'positive' : 'negative'}`;

    // 3. Calcolo percentuale Win Rate
    const winRate = transactionList.length > 0 ? ((winningTradesCount / transactionList.length) * 100).toFixed(0) : 0;
    document.getElementById('kpi-winrate').innerText = `${winRate}%`;

    // 4. Calcolo Risk/Reward Matematico (Profit Factor Reale)
    let profitFactor = 0.00;
    if (totalLossesValue > 0) {
        profitFactor = (totalWinsValue / totalLossesValue).toFixed(2);
    } else if (totalWinsValue > 0) {
        profitFactor = totalWinsValue.toFixed(2);
    }
    document.getElementById('kpi-rr').innerText = transactionList.length > 0 ? profitFactor : "0.00";

    // Aggiornamento Tabella Monitor Posizioni Attive (Ultime 3 esecuzioni)
    const openPositionsTbody = document.getElementById('open-positions-tbody');
    const recentRecords = transactionList.slice(-3).reverse();
    
    if (recentRecords.length === 0) {
        openPositionsTbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted); text-align:center;">Nessuna posizione a mercato</td></tr>`;
    } else {
        openPositionsTbody.innerHTML = recentRecords.map(r => `
            <tr>
                <td><b>${r.ticker}</b></td>
                <td><span class="tag-badge" style="background:${r.type === 'BUY' ? 'var(--crypto-green-glow)' : 'var(--crypto-red-glow)'}; color:${r.type === 'BUY' ? 'var(--crypto-green)' : 'var(--crypto-red)'}">${r.type}</span></td>
                <td>€100.00</td>
                <td>€${(100 + (r.amount / 100)).toFixed(2)}</td>
                <td style="color:${r.amount >= 0 ? 'var(--crypto-green)' : 'var(--crypto-red)'}">${r.amount >= 0 ? '+' : ''}€${r.amount.toFixed(2)}</td>
            </tr>
        `).join('');
    }
}

function renderPortfolioHistory() {
    const isReal = AppState.portfolioMode === 'real';
    const list = isReal ? AppState.realWallet.positions : AppState.demoWallet.trades;
    const tbody = document.getElementById('portfolio-history-tbody');

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted); text-align:center;">Nessuna operazione registrata all'interno dell'archivio</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(item => `
        <tr>
            <td>${item.date}</td>
            <td><b>${item.ticker}</b></td>
            <td><span class="tag-badge">${item.type}</span></td>
            <td style="color:${item.amount >= 0 ? 'var(--crypto-green)' : 'var(--crypto-red)'}">${item.amount >= 0 ? '+' : ''}€${item.amount.toFixed(2)}</td>
        </tr>
    `).join('');
}

/**
 * =========================================================================
 * 6. CHARTJS MOTOR (ANIMATED EQUITY CURVE)
 * =========================================================================
 */
function renderEquityCurve() {
    const canvasNode = document.getElementById('equityChart');
    if (!canvasNode) return;

    if (AppState.chartInstance) {
        AppState.chartInstance.destroy();
    }

    // Ricostruisce la serie progressiva cumulativa dei dati per l'asse Y
    const isReal = AppState.portfolioMode === 'real';
    let baseCapital = isReal ? 25000.00 : 100000.00;
    let dataPoints = [baseCapital];

    const operations = isReal ? AppState.realWallet.positions : AppState.demoWallet.trades;
    let cumulativeSum = baseCapital;
    
    operations.forEach(op => {
        cumulativeSum += op.amount;
        dataPoints.push(cumulativeSum);
    });

    const labels = dataPoints.map((_, index) => `Esec. ${index}`);

    AppState.chartInstance = new Chart(canvasNode, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#3b82f6',
                fill: true,
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: '#1e293b' }, ticks: { color: '#6b7280', font: { size: 10 } } },
                y: { grid: { color: '#1e293b' }, ticks: { color: '#6b7280', font: { size: 10 } } }
            }
        }
    });
}

/**
 * =========================================================================
 * 7. DIARIO CLOUD & GLOSSARIO ENGINES
 * =========================================================================
 */
function initDiaryEngine() {
    document.getElementById('diary-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('diary-title').value.trim();
        const rawTags = document.getElementById('diary-tags').value;
        const content = document.getElementById('diary-content').value.trim();
        
        const tags = rawTags ? rawTags.split(',').map(t => t.trim()) : [];

        if (supabase) {
            const { error } = await supabase.from('diary').insert([{ title, content, tags }]);
            if (!error) notify('success', 'Nota di trading salvata istantaneamente nel cloud!');
            await syncDiaryEntries();
        } else {
            notify('success', 'Nota salvata in locale temporaneo (Sandbox).');
        }
        document.getElementById('diary-form').reset();
    });
}

function renderDiaryDOM(items) {
    const container = document.getElementById('diary-entries-container');
    if (!container) return;

    container.innerHTML = items.map(item => `
        <div class="diary-card">
            <h4>${item.title}</h4>
            <p>${item.content}</p>
            <div>
                ${item.tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}
            </div>
        </div>
    `).join('');
}

function renderGlossaryDOM(items) {
    const box = document.getElementById('glossary-grid-box');
    if (!box) return;

    box.innerHTML = items.map(item => `
        <div class="glossary-card" data-term="${item.term.toLowerCase()}">
            <h4>${item.term}</h4>
            <p>${item.definition}</p>
            <div><span class="tag-badge" style="background:rgba(255,255,255,0.02); color:var(--text-muted);">${item.category}</span></div>
        </div>
    `).join('');
}

function filterGlossary(e) {
    const query = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.glossary-card').forEach(card => {
        const term = card.getAttribute('data-term');
        card.style.display = term.includes(query) ? 'flex' : 'none';
    });
}

/**
 * =========================================================================
 * 8. AI COPILOT SIMULATOR ENGINE
 * =========================================================================
 */
function initAICopilot() {
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');
    
    const sendMsg = () => {
        const query = input.value.trim();
        if (!query) return;

        const chatMessagesBox = document.getElementById('chat-messages-box');
        chatMessagesBox.innerHTML += `<div class="message user">${query}</div>`;
        input.value = '';
        chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;

        // Simulazione AI intelligente deterministica
        setTimeout(() => {
            let reply = "Segnale analizzato. Rilevato assorbimento volumetrico su Order Block H4. Considera la size in base alla volatilità stimata dall'ATR.";
            if (query.toLowerCase().includes('risk') || query.toLowerCase().includes('rischio')) {
                reply = "Rilevazione rischio: Il tuo Profit Factor attuale raccomanda uno stop loss protettivo inferiore all'1% per operazione.";
            } else if (query.toLowerCase().includes('win')) {
                reply = "Analisi performance: Il tuo win rate è stabile. Ti consiglio di lavorare sulla massimizzazione delle vincite tenendo i trade a target più a lungo.";
            }
            chatMessagesBox.innerHTML += `<div class="message ai">${reply}</div>`;
            chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
        }, 750);
    };

    sendBtn.addEventListener('click', sendMsg);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });
}

/**
 * =========================================================================
 * 9. UTILITIES (DEBOUNCE & PREMIUM BLUR TOAST NOTIFICATIONS)
 * =========================================================================
 */
function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

function notify(type, message) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);
    
    // Auto-distruzione programmata del toast
    setTimeout(() => {
        toast.style.animation = "slideInToast 0.3s ease reverse forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * =========================================================================
 * 10. PREMIUM PARTICLE CANVA LOOP (PERFORMANCE OPTIMIZED)
 * =========================================================================
 */
function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particleArray = [];

    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Creazione del pool di particelle
    for (let i = 0; i < 40; i++) {
        particleArray.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            speedX: (Math.random() - 0.5) * 0.25,
            speedY: (Math.random() - 0.5) * 0.25,
            radius: Math.random() * 1.5 + 0.5
        });
    }

    function renderLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
        
        particleArray.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;

            if (p.x < 0 || p.x > canvas.width) p.speedX *= -1;
            if (p.y < 0 || p.y > canvas.height) p.speedY *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        requestAnimationFrame(renderLoop);
    }
    renderLoop();
}