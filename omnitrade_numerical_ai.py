import sys
import json
import re
import os
import requests
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client, Client

# Configura l'encoding del terminale
sys.stdout.reconfigure(encoding='utf-8')

# Carica le variabili d'ambiente dal file .env
load_dotenv()

# Configurazione API OpenRouter letta in modo sicuro
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")

# CONFIGURAZIONE COMPLETA DI SUPABASE (letta in modo sicuro)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
# Usiamo la Secret Key (service_role) perché l'AI deve interagire con il database protetto
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY")

# Sessione personalizzata con User-Agent per bypassare il blocco di Yahoo Finance
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

# Inizializziamo il client database di Supabase in modo sicuro
supabase_attivo = False
supabase = None
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    supabase_attivo = True
except Exception as e:
    print(f"\n[Database Error] Impossibile inizializzare Supabase: {e}")
    print("[Avviso] Lo script continuera' a funzionare in locale, ma le funzioni cloud Supabase saranno disabilitate.")


INTERMARKET_TICKERS = {
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "VIX": "^VIX",
}

PROMPT_INTERMARKET = """
CRUSCOTTO INTERMARKET (Alpha Dashboard):
Applica la Liquidity Auction Theory in modalità macro confrontando l'asset analizzato con i tre fari istituzionali:
- DXY (Dollar Index): forza del dollaro. Correlazione inversa con asset rischiosi (Crypto, Azionario, Oro).
- US10Y (Rendimenti Bond USA 10Y): costo del denaro istituzionale. Yields in rialzo prosciugano liquidità da risk assets.
- VIX (Indice della Paura): volatilità implicita. VIX sopra VWAP = istituzioni in copertura, risk-off.

REGOLE DI CONFLUENZA:
1. FILTRO ANTI-FALSO SEGNALE: Se il setup tecnico sull'asset suggerisce Long (prezzo sotto VWAP) ma DXY e/o US10Y rompono al rialzo il VWAP, segnala ALERT CRITICO — il flusso intermarket contrasta il setup.
2. CONFLUENZA ALTA PROBABILITÀ: Se il setup tecnico concorda con il flusso monetario (es. Long su asset + DXY sotto VWAP + US10Y sotto VWAP), evidenzia il vento a favore istituzionale.
3. Per setup Short: logica inversa — confluenza se DXY e US10Y sopra VWAP con VIX in accelerazione.
"""


def ottieni_dati_asset(ticker, intervallo="1h", verbose=True):
    """Scarica i dati reali impostando il periodo massimo consentito da Yahoo Finance per quel timeframe."""
    mappatura_periodi = {
        "1m": "1d",   # 1 minuto: massimo 1 o 2 giorni di storico
        "5m": "5d",   # 5 minuti: analizziamo gli ultimi 5 giorni
        "15m": "5d",  # 15 minuti: ultimi 5 giorni
        "1h": "30d",  # 1 ora: ultimi 30 giorni
        "1d": "6mo"   # 1 giorno: ultimi 6 mesi per l'analisi macro
    }

    periodo = mappatura_periodi.get(intervallo, "30d")

    try:
        if verbose:
            print(f"\n[Sincronizzazione] Download dati storici per {ticker} | Timeframe: {intervallo} (Periodo: {periodo})...")
        dati = yf.download(tickers=ticker, period=periodo, interval=intervallo, progress=False, session=session)
        if dati.empty:
            return None

        # Appiattiamo l'indice delle colonne (MultiIndex di yfinance recente)
        if isinstance(dati.columns, pd.MultiIndex):
            dati.columns = dati.columns.get_level_values(0)

        # Rimuoviamo candele senza volume o le impostiamo a un minimo se stiamo testando indici particolari
        if 'Volume' not in dati.columns or dati['Volume'].sum() == 0:
            dati['Volume'] = 1000
        dati = dati[dati['Volume'] > 0].copy()

        # Calcolo matematico del VWAP e della Deviazione %
        prezzo_tipico = (dati['High'] + dati['Low'] + dati['Close']) / 3
        dati['VWAP'] = (prezzo_tipico * dati['Volume']).cumsum() / dati['Volume'].cumsum()
        dati['Deviazione_%'] = ((dati['Close'] - dati['VWAP']) / dati['VWAP']) * 100
        return dati
    except Exception as e:
        print(f"Errore nel recupero dati per {ticker}: {e}")
        return None


def ottieni_cruscotto_intermarket(intervallo="1h"):
    """Scarica DXY, US10Y e VIX con la stessa logica VWAP/Deviazione dell'asset principale."""
    print("\n[Alpha Dashboard] Sincronizzazione fari intermarket istituzionali (DXY, US10Y, VIX)...")
    cruscotto = {}
    for nome, ticker in INTERMARKET_TICKERS.items():
        dati = ottieni_dati_asset(ticker, intervallo, verbose=False)
        if dati is not None and not dati.empty:
            cruscotto[nome] = dati.iloc[-1]
        else:
            print(f"  [Warning] Impossibile caricare {nome} ({ticker})")
    return cruscotto


def formatta_matrice_intermarket(cruscotto):
    """Formatta la matrice intermarket per prompt AI e output terminale."""
    if not cruscotto:
        return "Dati intermarket non disponibili."

    righe = []
    for nome in ("DXY", "US10Y", "VIX"):
        if nome not in cruscotto:
            continue
        r = cruscotto[nome]
        ts = r.name.strftime('%Y-%m-%d %H:%M') if hasattr(r.name, 'strftime') else str(r.name)
        righe.append(
            f"{nome:6} | Prezzo: {float(r['Close']):>8.2f} | VWAP: {float(r['VWAP']):>8.2f} | "
            f"Deviazione: {float(r['Deviazione_%']):>+6.2f}% | Vol: {int(r['Volume'])} | {ts}"
        )
    return "\n".join(righe)


def valuta_confluenza_intermarket(deviazione_asset, cruscotto):
    """Valuta confluenza o divergenza tra setup tecnico asset e flusso intermarket."""
    if not cruscotto:
        return []

    alert = []
    dxy_dev = float(cruscotto["DXY"]["Deviazione_%"]) if "DXY" in cruscotto else 0
    us10y_dev = float(cruscotto["US10Y"]["Deviazione_%"]) if "US10Y" in cruscotto else 0
    vix_dev = float(cruscotto["VIX"]["Deviazione_%"]) if "VIX" in cruscotto else 0

    flusso_risk_off = dxy_dev > 0 or us10y_dev > 0 or vix_dev > 0.5
    flusso_risk_on = dxy_dev < 0 and us10y_dev < 0 and vix_dev < 0

    if deviazione_asset < -0.3:
        if flusso_risk_off:
            alert.append(
                "🚨 ALERT CRITICO — Setup Long tecnicamente valido (sotto VWAP), ma il flusso intermarket "
                "è RISK-OFF (DXY/US10Y/VIX in rialzo vs VWAP). Rischio elevato: attendere confluenza."
            )
        elif flusso_risk_on:
            alert.append(
                "✅ CONFLUENZA ALTA — Setup Long sull'asset + flusso monetario RISK-ON istituzionale "
                "(DXY e Yields sotto VWAP, VIX contenuto). Probabilità statistica massima."
            )
    elif deviazione_asset > 0.3:
        if flusso_risk_on:
            alert.append(
                "🚨 ALERT CRITICO — Setup Short tecnicamente valido (sopra VWAP), ma il flusso intermarket "
                "è RISK-ON (DXY/Yields sotto VWAP). Il vento istituzionale contrasta lo Short."
            )
        elif flusso_risk_off:
            alert.append(
                "✅ CONFLUENZA ALTA — Setup Short sull'asset + flusso RISK-OFF (Dollar e Yields forti, VIX in salita). "
                "Le istituzioni stanno prosciugando liquidità dai risk assets."
            )
    else:
        if flusso_risk_off:
            alert.append("⚠️  ATTENZIONE — Asset neutro vs VWAP, ma flusso intermarket RISK-OFF attivo. Cautela su posizioni Long.")
        elif flusso_risk_on:
            alert.append("ℹ️  Flusso intermarket RISK-ON: ambiente favorevole ai risk assets, attendi estensione dal VWAP per entry.")

    return alert


def stampa_cruscotto_alpha(cruscotto, deviazione_asset=None):
    """Stampa il cruscotto intermarket formattato nel terminale."""
    print("\n╔══════════════════════════════════════════════════════════════╗")
    print("║           ALPHA DASHBOARD — DEVIAZIONE INTERMARKET           ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    print("║  FARO IST.  │  PREZZO   │   VWAP    │ DEVIAZIONE │ DIREZIONE ║")
    print("╠══════════════════════════════════════════════════════════════╣")

    etichette = {
        "DXY": "Dollar Index",
        "US10Y": "Bond Yield 10Y",
        "VIX": "Indice Paura",
    }

    for nome in ("DXY", "US10Y", "VIX"):
        if nome not in cruscotto:
            print(f"║  {nome:10} │    N/D     │    N/D    │    N/D     │    —     ║")
            continue
        r = cruscotto[nome]
        dev = float(r["Deviazione_%"])
        direzione = "▲ RIALZO" if dev > 0 else ("▼ RIBASSO" if dev < 0 else "→ NEUTRO")
        print(
            f"║  {etichette[nome]:10} │ {float(r['Close']):>8.2f} │ {float(r['VWAP']):>8.2f} │ "
            f"{dev:>+7.2f}% │ {direzione:9} ║"
        )

    print("╚══════════════════════════════════════════════════════════════╝")

    if deviazione_asset is not None:
        alert = valuta_confluenza_intermarket(deviazione_asset, cruscotto)
        if alert:
            print("\n── VALUTAZIONE CONFLUENZA INTERMARKET ──")
            for msg in alert:
                print(f"  {msg}")


def ottieni_notizie_fondamentali(ticker):
    """Estrae le ultime notizie fondamentali rilevanti per l'asset."""
    try:
        print(f"[Analisi Fondamentale] Estrazione notizie in corso per {ticker}...")
        ticker_obj = yf.Ticker(ticker, session=session)
        notizie_grezze = ticker_obj.news

        if not notizie_grezze:
            return "Nessuna notizia recente trovata su Yahoo Finance."

        stringa_notizie = ""
        for n in notizie_grezze[:3]:
            # Compatibilità con le nuove versioni di yfinance che usano 'content'
            if isinstance(n, dict):
                titolo = n.get('title', n.get('content', {}).get('title', 'N/A'))
                editore = n.get('publisher', n.get('content', {}).get('provider', {}).get('displayName', 'N/A'))
            else:
                titolo = 'N/A'
                editore = 'N/A'
            stringa_notizie += f"- {titolo} (Fonte: {editore})\n"
        return stringa_notizie if stringa_notizie else "Nessuna notizia strutturata disponibile."
    except Exception as e:
        return f"Impossibile recuperare notizie fondamentali: {e}"


def scarica_glossario():
    """Scarica tutti i termini salvati nel glossario macro di Supabase."""
    if not supabase_attivo or supabase is None:
        return []
    try:
        res = supabase.table("glossary").select("termine, definizione, categoria").execute()
        return res.data if res.data else []
    except Exception:
        # Se la tabella non esiste ancora o c'e' un errore, fallisce silenziosamente senza bloccare lo script
        return []


def costruisci_prompt_con_glossario(prompt_base):
    """Integra le definizioni del glossario all'interno del prompt di sistema dell'AI."""
    glossario = scarica_glossario()
    if not glossario:
        return prompt_base

    contesto = "\n\nUsa e fai riferimento a questi concetti e definizioni didattiche (di Andrea Cimi) quando rispondi:\n"
    for g in glossario:
        contesto += f"- {g.get('termine')}: {g.get('definizione')} [Categoria: {g.get('categoria')}]\n"
    return prompt_base + contesto


def applica_glossario_su_testo(testo):
    """Cerca i termini del glossario all'interno del report AI e li spiega a fine output."""
    glossario = scarica_glossario()
    if not glossario:
        return

    trovati = []
    for g in glossario:
        termine = g.get("termine", "")
        definizione = g.get("definizione", "")
        categoria = g.get("categoria", "")
        if not termine:
            continue
        # Cerca il termine con parole intere
        pattern = re.compile(rf"\b{re.escape(termine)}\b", re.IGNORECASE)
        if pattern.search(testo):
            trovati.append((termine, definizione, categoria))

    if trovati:
        print("\n📖 GLOSSARIO RAPIDO DEI TERMINI RILEVATI NEL REPORT:")
        print(" ──────────────────────────────────────────────────────────")
        for term, defin, cat in trovati:
            print(f"  💡 {term.upper()} ({cat}):")
            print(f"     {defin}")
            print()
        print(" ──────────────────────────────────────────────────────────")


richieste_effettuate = 0


def mostra_stato_limiti():
    global richieste_effettuate
    richieste_effettuate += 1
    print(f"\n  [INFO SESSIONE] Richieste AI inviate in questa sessione: {richieste_effettuate}")
    try:
        res = session.get(
            "https://openrouter.ai/api/v1/key",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            timeout=5
        )
        if res.status_code == 200:
            info = res.json().get("data", {})
            free_tier = info.get("is_free_tier", True)
            limit = info.get("limit")
            remaining = info.get("limit_remaining")

            print("  [STATO API KEY]")
            if free_tier:
                print("   - Piano Account: GRATUITO (Free Tier)")
                print("   - Limiti       : Max 20 richieste/minuto (Rate Limit temporaneo)")
            else:
                print("   - Piano Account: A PAGAMENTO")
                if limit is not None and remaining is not None:
                    print(f"   - Limite Key  : ${limit:.5f}")
                    print(f"   - Rimanente   : ${remaining:.5f}")
                else:
                    print("   - Limite Key  : Nessun limite impostato")
            print("  " + "─" * 54)
        else:
            print("  [STATO API KEY] Impossibile recuperare i dati sui limiti da OpenRouter.")
    except Exception:
        pass


def interroga_ai(prompt_sistema, prompt_utente):
    """Invia la richiesta a un pool di modelli AI GRATUITI con fallback automatico."""
    modelli_gratuiti = [
        "openrouter/free",                          # 1. Fallback automatico dinamico (Sempre attivo, sceglie il migliore)
        "meta-llama/llama-3.3-70b-instruct:free",  # 2. Llama 3.3 (Meta)
        "google/gemma-4-31b-it:free",              # 3. Gemma 4 (Google)
        "meta-llama/llama-3.2-3b-instruct:free"    # 4. Llama 3.2 (Meta - backup leggero)
    ]

    for modello in modelli_gratuiti:
        try:
            print(f"[AI Console] Tentativo di comunicazione con il modello GRATUITO: {modello}...")
            response = session.post(
                url="https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                data=json.dumps({
                    "model": modello,
                    "messages": [
                        {"role": "system", "content": prompt_sistema},
                        {"role": "user", "content": prompt_utente}
                    ]
                }),
                timeout=20
            )

            if response.status_code == 200:
                res_json = response.json()
                if "error" in res_json:
                    print(f"[Warning] Il modello {modello} ha risposto con un errore API. Provo il successivo...")
                    continue
                print(f"[AI Console] Risposta ottenuta con successo da {modello}!")
                # Mostra i limiti dopo una risposta corretta
                mostra_stato_limiti()
                return res_json['choices'][0]['message']['content']
            else:
                print(f"[Warning] Il modello {modello} ha risposto con codice {response.status_code}. Provo il successivo...")
        except Exception as e:
            print(f"[Warning] Errore di connessione con {modello}: {e}. Provo il successivo...")

    return "Errore critico: Tutti i modelli AI gratuiti sono temporaneamente non disponibili."


# --- MAIN PROGRAM LOOP ---
print("")
print("==========================================================")
print("          OMNITRADE AI  —  TERMINAL CONSOLE              ")
print("==========================================================")
print()
print("  MENU PRINCIPALE — cosa puoi fare:")
print("  ─────────────────────────────────────────────────────")
print("  [1]  ANALISI COMPLETA")
print("       Scarica i dati VWAP + Deviazione degli ultimi 5")
print("       periodi, raccoglie le ultime notizie fondamentali")
print("       da Yahoo Finance e chiede all'AI di fare un")
print("       report integrato Tecnico + Fondamentale.")
print()
print("  [2]  BACKTEST MEAN REVERSION")
print("       Simula automaticamente l'ultimo periodo di dati:")
print("       ogni volta che il prezzo si discosta dal VWAP oltre")
print("       una soglia calibrata (0.3% per TF brevi, 3% per Daily),")
print("       genera un segnale e ne calcola il Winrate.")
print("       L'AI commenta i risultati statistici del timeframe.")
print()
print("  [3]  CHAT LIBERA CON L'AI")
print("       Fai qualsiasi domanda sul mercato, sulla macro-")
print("       economia o sulla strategia. L'AI risponde tenendo")
print("       conto dell'asset caricato e delle notizie live.")
print()
print("  [4]  SALVA DIARIO SU SUPABASE")
print("       Carica l'ultimo report e dati nel tuo diary cloud.")
print()
print("  [5]  CLOUD EXPLORER")
print("       Esplora lo storico del diary o gestisci il glossario.")
print()
print("  [6]  ALPHA DASHBOARD (Intermarket)")
print("       Cruscotto DXY + US10Y + VIX vs VWAP in tempo reale.")
print("       Rileva confluenza o divergenza con il tuo asset attivo.")
print()
print("  [0]  ESCI")
print("       Chiude il programma.")
print("  ─────────────────────────────────────────────────────")
print()
print("  Ticker validi: BTC-USD  |  EURUSD=X  |  AAPL  |  GC=F (Oro)")
print("                 ETH-USD  |  ^GSPC (S&P500)  |  TSLA  |  ...")
print()

ticker_scelto = input("  Inserisci il TICKER dell'asset da analizzare: ").upper().strip()

# SELEZIONE DEL TIMEFRAME NATIVO
print("\n  --- SELEZIONA IL TIMEFRAME OPERATIVO ---")
print("   [1] 5 Minuti   → Ideale per lo Scalping veloce")
print("   [2] 15 Minuti  → Day Trading classico")
print("   [3] 1 Ora      → Swing Trading di breve periodo")
print("   [4] 1 Giorno   → Analisi Macroeconomica / Posizionamento")
scelta_tf = input("\n  Scegli un timeframe (1-4): ").strip()

mappatura_tf = {"1": "5m", "2": "15m", "3": "1h", "4": "1d"}
tf_scelto = mappatura_tf.get(scelta_tf, "1h")  # Se sbaglia, di default imposta 1 ora

dati_asset = ottieni_dati_asset(ticker_scelto, intervallo=tf_scelto)

if dati_asset is None:
    print("Impossibile caricare l'asset inserito. Verifica il ticker e riprova.")
    exit()

print(f"-> Asset {ticker_scelto} caricato con successo sul Timeframe [{tf_scelto}]! ({len(dati_asset)} candele)")

prompt_base_sistema = f"""
Sei l'assistente quantitativo capo di OmniTrade AI. Analizzi l'asset {ticker_scelto} sul Timeframe {tf_scelto}.
Adatta la tua logica operativa in base al timeframe:
- Se il timeframe è veloce (5m/15m), concentrati sulla reattività dei volumi, assorbimenti veloci e la caccia alla liquidità intraday.
- Se il timeframe è lento (1d), ragiona in ottica macroeconomica, trend strutturali e grandi squilibri di prezzo.
Non usare indicatori classici (RSI, MACD) o pattern geometrici astratti. Concentrati solo su Prezzo, Volume e VWAP.
{PROMPT_INTERMARKET}
"""

# Memoria temporanea nello script
ultima_analisi_generata = None

while True:
    print()
    print("  ══════════════════════════════════════════════════════")
    print(f"  ASSET ATTIVO: {ticker_scelto} | TIMEFRAME: {tf_scelto}")
    print("  ──────────────────────────────────────────────────────")
    print("  [1]  Analisi Completa   → VWAP + Notizie + AI (Pool)")
    print("  [2]  Backtest           → Winrate Mean Reversion")
    print("  [3]  Chat Libera        → Fai una domanda all'AI")
    print("  [4]  Salva Diario       → Carica report su Supabase Cloud")
    print("  [5]  Cloud Explorer     → Storico Diario & Glossario Macro")
    print("  [6]  Alpha Dashboard    → Cruscotto Intermarket DXY/US10Y/VIX")
    print("  [0]  Esci               → Chiude il programma")
    print("  ══════════════════════════════════════════════════════")

    scelta = input("\n  Seleziona un'opzione (0-6): ").strip()

    if scelta == "1":
        sintesi = dati_asset.tail(5)
        tabella_stringa = pd.DataFrame({
            "Data_Ora": sintesi.index.strftime('%Y-%m-%d %H:%M'),
            "Prezzo": sintesi['Close'].values.flatten().round(2),
            "VWAP": sintesi['VWAP'].values.flatten().round(2),
            "Deviazione_%": sintesi['Deviazione_%'].values.flatten().round(2),
            "Volume": sintesi['Volume'].values.flatten().astype(int)
        }).to_string(index=False)

        notizie_live = ottieni_notizie_fondamentali(ticker_scelto)
        cruscotto = ottieni_cruscotto_intermarket(tf_scelto)
        matrice_intermarket = formatta_matrice_intermarket(cruscotto)
        deviazione_asset = float(dati_asset.iloc[-1]['Deviazione_%'])
        alert_confluenza = valuta_confluenza_intermarket(deviazione_asset, cruscotto)

        stampa_cruscotto_alpha(cruscotto, deviazione_asset)

        alert_testo = "\n".join(alert_confluenza) if alert_confluenza else "Nessun alert intermarket critico rilevato."

        input_utente = (
            f"MATRICE DATI NUMERICI ({tf_scelto}) — {ticker_scelto}:\n{tabella_stringa}\n\n"
            f"CRUSCOTTO INTERMARKET (Deviazione VWAP %):\n{matrice_intermarket}\n\n"
            f"VALUTAZIONE CONFLUENZA AUTOMATICA:\n{alert_testo}\n\n"
            f"ULTIME NOTIZIE FONDAMENTALI:\n{notizie_live}"
        )

        ultima_analisi_generata = interroga_ai(
            prompt_sistema=costruisci_prompt_con_glossario(prompt_base_sistema) + " Esegui un report strutturato dividendo l'analisi tra: (1) Struttura Tecnica dei Volumi sul TF attuale, (2) Cruscotto Intermarket e Confluenza istituzionale, (3) Impatto Fondamentale.",
            prompt_utente=input_utente
        )
        print(f"\n=== RISPOSTA OMNITRADE AI ===\n{ultima_analisi_generata}\n=============================")
        applica_glossario_su_testo(ultima_analisi_generata)

    elif scelta == "2":
        trade_eseguiti = []
        soglia = 0.3 if tf_scelto in ["5m", "15m"] else (3.0 if tf_scelto == "1d" else 1.0)

        for i in range(len(dati_asset) - 5):
            riga = dati_asset.iloc[i]
            dev = riga['Deviazione_%']
            if dev < -soglia:
                trade_eseguiti.append("WIN" if dati_asset.iloc[i + 1]['Close'] > riga['Close'] else "LOSS")
            elif dev > soglia:
                trade_eseguiti.append("WIN" if dati_asset.iloc[i + 1]['Close'] < riga['Close'] else "LOSS")

        totale = len(trade_eseguiti)
        winrate = (trade_eseguiti.count("WIN") / totale * 100) if totale > 0 else 0
        report_str = f"Asset: {ticker_scelto} | Timeframe: {tf_scelto}\nSoglia di attivazione Mean Reversion: {soglia}%\nTotale segnali generati: {totale}\nWinrate stimato (RR 1:2): {winrate:.2f}%"

        print("\nRichiesta verdetto strategico all'AI...")
        cruscotto = ottieni_cruscotto_intermarket(tf_scelto)
        matrice_intermarket = formatta_matrice_intermarket(cruscotto)
        report_str += f"\n\nCRUSCOTTO INTERMARKET:\n{matrice_intermarket}"

        risposta = interroga_ai(
            prompt_sistema=costruisci_prompt_con_glossario(prompt_base_sistema) + f" Valuta la fattibilità matematica di questa strategia su candele a {tf_scelto}, considerando anche il contesto intermarket.",
            prompt_utente=report_str
        )
        print(f"\n=== RISPOSTA OMNITRADE AI ===\n{risposta}\n=============================")
        applica_glossario_su_testo(risposta)

    elif scelta == "3":
        domanda_utente = input("\nScrivi la tua domanda personalizzata: ")
        if domanda_utente.strip() == "":
            continue

        notizie_live = ottieni_notizie_fondamentali(ticker_scelto)
        cruscotto = ottieni_cruscotto_intermarket(tf_scelto)
        matrice_intermarket = formatta_matrice_intermarket(cruscotto)
        deviazione_asset = float(dati_asset.iloc[-1]['Deviazione_%'])
        alert_confluenza = valuta_confluenza_intermarket(deviazione_asset, cruscotto)
        alert_testo = "\n".join(alert_confluenza) if alert_confluenza else "Nessun alert."

        input_completo = (
            f"Contesto Timeframe: {tf_scelto}\n"
            f"Deviazione VWAP asset: {deviazione_asset:+.2f}%\n"
            f"Cruscotto Intermarket:\n{matrice_intermarket}\n"
            f"Alert Confluenza: {alert_testo}\n"
            f"Notizie:\n{notizie_live}\n\n"
            f"Domanda: {domanda_utente}"
        )

        risposta = interroga_ai(prompt_sistema=costruisci_prompt_con_glossario(prompt_base_sistema), prompt_utente=input_completo)
        print(f"\n=== RISPOSTA OMNITRADE AI ===\n{risposta}\n=============================")
        applica_glossario_su_testo(risposta)

    elif scelta == "4":
        if not supabase_attivo or supabase is None:
            print("\n[Errore Database] Il client Supabase non e' attivo. Verifica le tue chiavi e la connessione.")
            continue

        if ultima_analisi_generata is None:
            print("\n[Errore] Devi prima generare un'Analisi Completa (Opzione 1) prima di poterla salvare nel diary!")
            continue

        print("\n[Database] Connessione a Supabase in corso...")
        riga_recente = dati_asset.iloc[-1]
        stato_emotivo_utente = input("Come ti senti psicologicamente rispetto a questo mercato? (es. Disciplinato, Ansioso, FOMO, Calmo): ").strip()
        if not stato_emotivo_utente:
            stato_emotivo_utente = "Non Specificato"

        dati_diary = {
            "ticker": ticker_scelto,
            "timeframe": tf_scelto,
            "prezzo_ingresso": float(riga_recente['Close']),
            "distanza_vwap": float(riga_recente['Deviazione_%']),
            "volume_tick": int(riga_recente['Volume']),
            "stato_emotivo": stato_emotivo_utente,
            "report_ai": ultima_analisi_generata
        }

        try:
            supabase.table("diary_trading").insert(dati_diary).execute()
            print("\n[SUCCESS] Report quantitativo-fondamentale salvato correttamente nel tuo Diario Cloud Supabase!")
        except Exception as db_err:
            print(f"\n[Errore Database] Impossibile salvare la riga su Supabase: {db_err}")
            print("[Suggerimento] Assicurati di aver creato la tabella 'diary_trading' con lo schema corretto nel tuo SQL Editor.")

    elif scelta == "5":
        if not supabase_attivo or supabase is None:
            print("\n[Errore Database] Il client Supabase non e' attivo.")
            continue

        print("\n══════════════════════════════════════════════════════")
        print("          CLOUD EXPLORER (SUPABASE METRICS)           ")
        print("══════════════════════════════════════════════════════")
        print(" [1] Visualizza gli ultimi 5 salvataggi del Diario")
        print(" [2] Visualizza tutto il Glossario Macro")
        print(" [3] Aggiungi un nuovo termine al Glossario Cloud")
        print(" [0] Ritorna al Menu Principale")
        print("──────────────────────────────────────────────────────")

        sub_scelta = input("\nSeleziona una sotto-opzione (0-3): ").strip()

        if sub_scelta == "1":
            try:
                print("\n[Database] Download cronologia diary...")
                res = supabase.table("diary_trading").select("data_ora, ticker, timeframe, prezzo_ingresso, distanza_vwap, stato_emotivo").order("data_ora", desc=True).limit(5).execute()
                records = res.data
                if not records:
                    print("Nessun report salvato trovato nel database.")
                else:
                    print("\n--- ULTIMI 5 SALVATAGGI NEL diary CLOUD ---")
                    for idx, r in enumerate(records, 1):
                        data_pulita = r.get("data_ora", "").split(".")[0].replace("T", " ")
                        print(f" #{idx} | Data: {data_pulita} | Ticker: {r.get('ticker')} | TF: {r.get('timeframe')}")
                        print(f"    Prezzo: {r.get('prezzo_ingresso')} | Dev.VWAP: {r.get('distanza_vwap'):.2f}% | Sentiment: {r.get('stato_emotivo')}")
                        print("   " + "─" * 50)
            except Exception as e:
                print(f"Errore nel recuperare la cronologia dal diary: {e}")

        elif sub_scelta == "2":
            try:
                glossario = scarica_glossario()
                if not glossario:
                    print("Nessun termine registrato nel glossario cloud.")
                else:
                    print(f"\n--- GLOSSARIO CLOUD ATTIVO ({len(glossario)} Termini) ---")
                    for idx, g in enumerate(glossario, 1):
                        print(f" {idx}. {g.get('termine').upper()} [{g.get('categoria')}]")
                        print(f"    Definizione: {g.get('definizione')}")
                        print("   " + "─" * 50)
            except Exception as e:
                print(f"Errore durante l'esplorazione del glossario: {e}")

        elif sub_scelta == "3":
            print("\n--- AGGIUNGI NUOVO TERMINE AL GLOSSARIO ---")
            termine = input("Nome del termine (es. Stagflazione): ").strip()
            if not termine:
                continue
            definizione = input("Inserisci la spiegazione/definizione didattica: ").strip()
            if not definizione:
                continue
            print("\nSeleziona una categoria:")
            print(" [1] Macroeconomia")
            print(" [2] Analisi Quantitativa")
            print(" [3] Psicologia del Trading")
            cat_scelta = input("Categoria (1-3): ").strip()
            cat_map = {"1": "Macroeconomia", "2": "Analisi Quantitativa", "3": "Psicologia del Trading"}
            categoria = cat_map.get(cat_scelta, "Macroeconomia")

            try:
                dati_termine = {
                    "termine": termine,
                    "definizione": definizione,
                    "categoria": categoria
                }
                supabase.table("glossary").insert(dati_termine).execute()
                print(f"\n[SUCCESS] Termine '{termine}' aggiunto correttamente al glossario di Supabase!")
            except Exception as e:
                print(f"Errore durante l'inserimento del termine: {e}")

    elif scelta == "6":
        cruscotto = ottieni_cruscotto_intermarket(tf_scelto)
        deviazione_asset = float(dati_asset.iloc[-1]['Deviazione_%'])
        stampa_cruscotto_alpha(cruscotto, deviazione_asset)

        print(f"\n  Asset attivo: {ticker_scelto} | Deviazione VWAP: {deviazione_asset:+.2f}%")
        print("\n  [A] Analisi AI completa del cruscotto intermarket")
        print("  [Invio] Torna al menu principale")
        sub = input("\n  Scegli un'azione: ").strip().upper()

        if sub == "A":
            matrice_intermarket = formatta_matrice_intermarket(cruscotto)
            alert_confluenza = valuta_confluenza_intermarket(deviazione_asset, cruscotto)
            alert_testo = "\n".join(alert_confluenza) if alert_confluenza else "Nessun alert critico."

            input_utente = (
                f"ASSET ANALIZZATO: {ticker_scelto} ({tf_scelto}) | Deviazione VWAP: {deviazione_asset:+.2f}%\n\n"
                f"CRUSCOTTO INTERMARKET:\n{matrice_intermarket}\n\n"
                f"ALERT CONFLUENZA:\n{alert_testo}\n\n"
                f"Applica la Liquidity Auction Theory in modalità macro. "
                f"Indica se il flusso monetario istituzionale supporta o contrasta un'operatività su {ticker_scelto}."
            )

            ultima_analisi_generata = interroga_ai(
                prompt_sistema=costruisci_prompt_con_glossario(prompt_base_sistema) + " Esegui un report dedicato al Cruscotto Intermarket: analizza DXY, US10Y e VIX vs VWAP e la loro confluenza con l'asset attivo.",
                prompt_utente=input_utente
            )
            print(f"\n=== RISPOSTA OMNITRADE AI — ALPHA DASHBOARD ===\n{ultima_analisi_generata}\n{'=' * 47}")
            applica_glossario_su_testo(ultima_analisi_generata)

    elif scelta == "0" or scelta.lower() == "esci":
        print("\nChiusura della console. Buona sessione di trading!")
        break
    else:
        print("Opzione non valida. Riprova.")
