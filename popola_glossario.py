import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Carica le variabili d'ambiente dal file .env
load_dotenv()

# Prendi le credenziali in modo sicuro
SUPABASE_URL = os.environ.get("SUPABASE_URL")
# Usiamo la Secret Key (service_role) perché questo script deve scrivere nel glossario blindato
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY")

try:
    print("[Database Cloud] Inizializzazione client Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Lista strutturata con i 12 termini didattici di Andrea Cimi (incluso VWAP)
    termini_cimi = [
        {
            "termine": "Liquidity Auction Theory",
            "definizione": "Modello che analizza il mercato come un'asta continua a doppia via (Double Auction System) in cui il prezzo si muove unicamente per trovare la liquidità necessaria ad incrociare domanda e offerta.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "Order Flow",
            "definizione": "Il flusso continuo di ordini eseguiti a mercato in tempo reale. È l'unico vero indicatore anticipatore oggettivo delle intenzioni degli operatori istituzionali.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "Assorbimento",
            "definizione": "Fenomeno in cui gli ordini aggressivi a mercato (Market Orders) vengono bloccati e assorbiti da massicci ordini limite passivi (Limit Orders) posizionati dalle istituzioni su livelli chiave.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "Aggressione",
            "definizione": "La spinta dei partecipanti al mercato che utilizzano ordini a mercato (Market) per entrare immediatamente a spread, generando l'effettivo sbilanciamento del prezzo.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "Volume Tick",
            "definizione": "Il conteggio esatto del numero di transazioni eseguite per ogni variazione di prezzo (tick), indicatore puro di intensità istituzionale rispetto al volume a tempo.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "VWAP",
            "definizione": "Volume Weighted Average Price (Prezzo Medio Ponderato per i Volumi). Rappresenta il 'Fair Value' (valore equo) istituzionale della sessione. Deviazioni estreme indicano opportunità di Mean Reversion.",
            "categoria": "Liquidity Auction Theory"
        },
        {
            "termine": "Intermarket Analysis",
            "definizione": "Analisi comparata dei flussi finanziari tra i mercati Azionario, Obbligazionario (Bond Yields), Valutario (Forex) e Materie Prime per individuare la rotazione globale del denaro.",
            "categoria": "Struttura di Mercato"
        },
        {
            "termine": "Smart Money",
            "definizione": "Istituzioni finanziarie informate, banche d'affari e Hedge Fund che detengono il capitale pesante e guidano le tendenze volumetriche di lungo periodo.",
            "categoria": "Struttura di Mercato"
        },
        {
            "termine": "Market Makers",
            "definizione": "Fornitori istituzionali di liquidità bidirezionale sul book d'ordine. Traggono profitto dallo spread e gestiscono l'inventario dei contratti senza prendere posizioni direzionali.",
            "categoria": "Struttura di Mercato"
        },
        {
            "termine": "Vantaggio Statistico",
            "definizione": "Edge matematico oggettivo, formalizzato a piano di trading, che garantisce un'aspettativa di profitto positiva su un ampio campione di trade (es. Profit Factor > 1.1).",
            "categoria": "Statistica & Mindset"
        },
        {
            "termine": "Backtesting",
            "definizione": "Validazione matematica di una strategia applicata a una serie storica del passato su un campione di almeno 200 operazioni per dimostrarne l'Edge storico.",
            "categoria": "Statistica & Mindset"
        },
        {
            "termine": "Process-Oriented Mindset",
            "definizione": "Approccio psicologico focalizzato esclusivamente sulla precisione esecutiva del piano e sulla gestione del rischio, ignorando l'emotività legata al profitto o alla perdita immediata.",
            "categoria": "Statistica & Mindset"
        }
    ]

    print("[Database Cloud] Caricamento ottimizzato dei 12 termini didattici...")

    # Ottimizzazione: Usiamo un singolo inserimento batch (upsert) invece di fare 12 richieste HTTP separate.
    # Questo velocizza il caricamento di circa 10 volte ed evita timeout.
    risposta = supabase.table("glossary").upsert(termini_cimi, on_conflict="termine").execute()
    
    print(f"\n[SUCCESS] Inseriti/Aggiornati con successo {len(risposta.data)} termini su Supabase!")
    print("\nEcco l'elenco dei termini configurati:")
    for record in risposta.data:
        print(f" - {record['termine']} ({record['categoria']})")
        
except Exception as e:
    print(f"\n[Errore] Impossibile caricare il glossario su Supabase: {e}")
    print("[Suggerimento] Assicurati di aver eseguito lo script SQL per creare la tabella 'glossary' nel pannello Supabase.")
