-- Abilita l'estensione per la generazione dei codici UUID universali
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- 1. TABELLA: WALLET REAL
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.wallet_real (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    deposits JSONB NOT NULL DEFAULT '[]'::jsonb,
    withdrawals JSONB NOT NULL DEFAULT '[]'::jsonb,
    positions JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Commenti strutturali per documentazione interna database
COMMENT ON TABLE public.wallet_real IS 'Contiene il saldo reale corrente e gli storici strutturati in array JSONB.';

-- =========================================================================
-- 2. TABELLA: WALLET DEMO
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.wallet_demo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    balance NUMERIC(15, 2) NOT NULL DEFAULT 100000.00,
    trades JSONB NOT NULL DEFAULT '[]'::jsonb,
    equity_curve JSONB NOT NULL DEFAULT '[100000]'::jsonb
);
COMMENT ON TABLE public.wallet_demo IS 'Contiene il saldo virtuale e la cronologia dei finti trade con annessa traccia della curva di equity.';

-- =========================================================================
-- 3. TABELLA: DIARY (Diario Cloud)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.diary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}'::text[]
);
COMMENT ON TABLE public.diary IS 'Note operative e psicologiche del trader salvate in cloud.';

-- =========================================================================
-- 4. TABELLA: GLOSSARIO (Glossario Cimi)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.glossary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term TEXT NOT NULL UNIQUE,
    definition TEXT NOT NULL,
    category TEXT NOT NULL
);
COMMENT ON TABLE public.glossary IS 'Dizionario dei termini tecnici di trading per la sezione formativa.';

-- =========================================================================
-- INDICI DI PERFORMANCE (Ottimizzazione Query di Ricerca e Ordinamento)
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_diary_created_at_desc ON public.diary(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_glossary_term_search ON public.glossaryUsing btree (lower(term));
CREATE INDEX IF NOT EXISTS idx_glossary_category ON public.glossary(category);

-- =========================================================================
-- SICUREZZA: DISATTIVAZIONE RLS (Row Level Security) PER SVILUPPO INIZIALE
-- =========================================================================
ALTER TABLE public.wallet_real DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_demo DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.diary DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.glossary DISABLE ROW LEVEL SECURITY;

-- =========================================================================
-- SEED INIZIALE DEI DATI (Garanzia di avvio senza tabelle vuote)
-- =========================================================================
-- Inserimento del record utente di default per il Conto Reale
INSERT INTO public.wallet_real (balance, deposits, withdrawals, positions)
VALUES (
    25000.00, 
    '[{"amount": 25000.00, "date": "2026-01-01", "type": "DEPOSIT"}]'::jsonb, 
    '[]'::jsonb, 
    '[]'::jsonb
) ON CONFLICT DO NOTHING;

-- Inserimento del record utente di default per il Conto Demo
INSERT INTO public.wallet_demo (balance, trades, equity_curve)
VALUES (
    100000.00, 
    '[]'::jsonb, 
    '[100000.00]'::jsonb
) ON CONFLICT DO NOTHING;

-- Inserimento concetti chiave nel Glossario Cimi
INSERT INTO public.glossary (term, definition, category) VALUES
('Order Block', 'Zone di prezzo specifiche dove le istituzioni finanziarie e le banche centrali hanno piazzato ordini massicci lasciando tracce volumetriche.', 'Price Action'),
('Fair Value Gap (FVG)', 'Inefficienza strutturale o sbilanciamento generato da una singola candela ad alta estensione impulsiva che non lascia spazio alla controparte.', 'Anomalie'),
('Risk to Reward (RR)', 'Il rapporto matematico che calcola il potenziale profitto di un setup rispetto al rischio massimo prefissato dallo Stop Loss.', 'Risk Management'),
('Liquidity Sweep', 'Movimento manipolativo del prezzo mirato a catturare gli ordini di Stop Loss (liquidità) posizionati sopra i massimi o sotto i minimi relativi.', 'Price Action'),
('Win Rate', 'La metrica percentuale che esprime il numero di trade chiusi in profitto rispetto al totale complessivo delle operazioni eseguite.', 'Statistiche')
ON CONFLICT (term) DO NOTHING;
