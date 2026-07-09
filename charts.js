/**
 * =========================================================================
 * OMNITRADE MARKET CHART ENGINE (charts.js)
 * Architecture: Automated CSV Parsing & Chart.js Multiaxis Rendering
 * =========================================================================
 */

let marketChartInstance = null;

// Si attiva automaticamente quando il DOM è pronto
document.addEventListener('DOMContentLoaded', () => {
    inizializzaAnalisiStorica();
});

/**
 * Carica il file CSV locale ed estrae i vettori di dati tramite PapaParse
 */
function inizializzaAnalisiStorica() {
    console.log('[Chart Engine] Caricamento file dati_mercato.csv...');

    Papa.parse('dati_mercato.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            console.log('[Chart Engine] CSV Parsato con successo. Righe:', results.data.length);
            renderizzaGraficoMercato(results.data);
        },
        error: function(err) {
            console.error('[Chart Engine Error] Impossibile caricare il CSV:', err.message);
        }
    });
}

/**
 * Configura e disegna il grafico combinato Prezzo/Volume/VWAP
 */
function renderizzaGraficoMercato(dataRows) {
    const ctx = document.getElementById('market-historical-chart');
    if (!ctx) {
        console.warn("[Chart Engine] Canvas 'market-historical-chart' non trovato nel DOM.");
        return;
    }

    const labels = dataRows.map(row => row.Timestamp);
    const prezziChiusura = dataRows.map(row => parseFloat(row.Prezzo_Chiusura));
    const volumi = dataRows.map(row => parseFloat(row.Volume_Tick));
    const vwap = dataRows.map(row => parseFloat(row.VWAP));

    if (marketChartInstance) {
        marketChartInstance.destroy();
    }

    marketChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Prezzo Chiusura (€)',
                    data: prezziChiusura,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.2,
                    yAxisID: 'y-prezzo'
                },
                {
                    label: 'VWAP (€)',
                    data: vwap,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    yAxisID: 'y-prezzo'
                },
                {
                    label: 'Volume Tick',
                    type: 'bar',
                    data: volumi,
                    backgroundColor: 'rgba(239, 68, 68, 0.25)',
                    hoverBackgroundColor: 'rgba(239, 68, 68, 0.45)',
                    yAxisID: 'y-volume',
                    barPercentage: 0.6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#9ca3af', font: { family: 'Inter' } }
                },
                tooltip: {
                    backgroundColor: '#1f2937',
                    titleColor: '#f9fafb',
                    bodyColor: '#d1d5db',
                    borderColor: '#374151',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(55, 65, 81, 0.3)' },
                    ticks: { color: '#9ca3af', maxTicksLimit: 12 }
                },
                'y-prezzo': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(55, 65, 81, 0.3)' },
                    ticks: { color: '#3b82f6' }
                },
                'y-volume': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#ef4444', maxTicksLimit: 5 },
                    max: Math.max(...volumi) * 4
                }
            }
        }
    });
}

