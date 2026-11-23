-- ==============================================================================
-- OMNITRADE AI - MASTER DATABASE SCHEMA (FASE 1)
-- Compatibile con Supabase PostgreSQL, Row Level Security (RLS) & Auth
-- ==============================================================================

-- 1. UTENTI & PROFILI (estensione di auth.users)
create table if not exists public.user_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role text not null default 'Registered Trader' check (role in ('Guest', 'Registered Trader', 'Premium Trader', 'Admin')),
    username text unique,
    daily_loss_limit numeric(12,2) default 500.00,
    weekly_loss_limit numeric(12,2) default 1500.00,
    monthly_drawdown_limit numeric(5,2) default 10.00, -- percentuale
    circuit_breaker_active boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. ASSET SUPPORTATI
create table if not exists public.assets (
    symbol text primary key,
    name text not null,
    asset_class text not null check (asset_class in ('crypto', 'forex', 'indices', 'commodities', 'stocks')),
    base_currency text default 'USD',
    tick_size numeric(10,6) default 0.01,
    default_spread numeric(10,6) default 0.0,
    commission_per_lot numeric(10,4) default 0.0,
    is_active boolean default true
);

-- 3. STRATEGIE
create table if not exists public.strategies (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text not null,
    description text,
    category text default 'Mean Reversion',
    rules_json jsonb default '{}'::jsonb not null,
    is_public boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. VERSIONAMENTO STRATEGIE
create table if not exists public.strategy_versions (
    id uuid primary key default gen_random_uuid(),
    strategy_id uuid references public.strategies(id) on delete cascade,
    version_number int not null default 1,
    changelog text,
    rules_json jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. BACKTEST RUNS
create table if not exists public.backtests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    strategy_id uuid references public.strategies(id) on delete set null,
    asset_symbol text references public.assets(symbol) on delete set null,
    timeframe text not null,
    session_filter text default 'ALL' check (session_filter in ('ALL', 'TOKYO', 'LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP', 'CUSTOM')),
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    initial_balance numeric(14,2) default 10000.00,
    final_balance numeric(14,2),
    total_trades int default 0,
    winning_trades int default 0,
    losing_trades int default 0,
    win_rate numeric(6,2),
    profit_factor numeric(8,2),
    expectancy numeric(8,2),
    max_drawdown numeric(6,2),
    net_profit numeric(14,2),
    sharpe_ratio numeric(8,2),
    sortino_ratio numeric(8,2),
    recovery_factor numeric(8,2),
    risk_of_ruin numeric(6,2),
    equity_curve jsonb default '[]'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. SINGOLI TRADE DEL BACKTEST / ESECUZIONE
create table if not exists public.trades (
    id uuid primary key default gen_random_uuid(),
    backtest_id uuid references public.backtests(id) on delete cascade,
    user_id uuid references auth.users(id) on delete cascade,
    symbol text not null,
    direction text not null check (direction in ('long', 'short')),
    entry_time timestamp with time zone not null,
    exit_time timestamp with time zone,
    entry_price numeric(14,6) not null,
    exit_price numeric(14,6),
    stop_loss numeric(14,6),
    take_profit numeric(14,6),
    quantity numeric(14,4) not null,
    pnl numeric(14,2),
    session_tag text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. DIARIO TRADING DISCREZIONALE (JOURNAL EVOLUTO)
create table if not exists public.journals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    trade_id uuid references public.trades(id) on delete set null,
    ticker text not null,
    timeframe text not null,
    session_tag text,
    entry_price numeric(14,6),
    exit_price numeric(14,6),
    pnl numeric(14,2),
    emotional_state text check (emotional_state in ('Disciplinato', 'Calmo', 'Ansioso', 'FOMO', 'Euforico', 'Frustrato', 'Non Specificato')),
    mistake_tag text, -- es. 'Anticipo Entrata', 'Overleveraging', 'Violazione Regole'
    notes text,
    screenshot_url text,
    ai_feedback text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. REGIME DI MERCATO MACRO
create table if not exists public.market_regimes (
    id uuid primary key default gen_random_uuid(),
    regime text not null check (regime in ('Risk On', 'Neutral', 'Risk Off', 'Cash Priority')),
    vix_level numeric(6,2),
    dxy_level numeric(6,2),
    yield_10y numeric(6,3),
    ai_analysis text,
    calculated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 9. ALERTS
create table if not exists public.alerts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    symbol text not null,
    condition_type text not null, -- 'VWAP_DEV', 'PRICE_LEVEL', 'MACRO_NEWS'
    threshold_value numeric(14,4),
    is_active boolean default true,
    triggered_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 10. RISULTATI AGGREGATI PER SESSIONE (SESSION ANALYTICS)
create table if not exists public.session_results (
    id uuid primary key default gen_random_uuid(),
    strategy_id uuid references public.strategies(id) on delete cascade,
    session_name text not null check (session_name in ('TOKYO', 'LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP', 'CUSTOM')),
    total_trades int default 0,
    win_rate numeric(6,2),
    profit_factor numeric(8,2),
    net_pnl numeric(14,2),
    avg_trade_pnl numeric(10,2),
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

alter table public.user_profiles enable row level security;
alter table public.assets enable row level security;
alter table public.strategies enable row level security;
alter table public.strategy_versions enable row level security;
alter table public.backtests enable row level security;
alter table public.trades enable row level security;
alter table public.journals enable row level security;
alter table public.market_regimes enable row level security;
alter table public.alerts enable row level security;
alter table public.session_results enable row level security;

-- Policy per user_profiles
create policy "Gli utenti possono visualizzare e modificare il proprio profilo"
    on public.user_profiles for all using (auth.uid() = id);

-- Policy per assets (pubblici in lettura)
create policy "Gli asset sono consultabili da tutti gli utenti autenticati"
    on public.assets for select using (true);

-- Policy per strategies
create policy "Gli utenti gestiscono le proprie strategie o leggono quelle pubbliche"
    on public.strategies for all using (auth.uid() = user_id or is_public = true);

-- Policy per backtests
create policy "Gli utenti visualizzano solo i propri backtest"
    on public.backtests for all using (auth.uid() = user_id);

-- Policy per trades
create policy "Gli utenti visualizzano solo i propri trade"
    on public.trades for all using (auth.uid() = user_id);

-- Policy per journals
create policy "Gli utenti visualizzano e gestiscono il proprio diario"
    on public.journals for all using (auth.uid() = user_id);

-- Policy per alerts
create policy "Gli utenti gestiscono i propri alert"
    on public.alerts for all using (auth.uid() = user_id);

-- Policy per market_regimes (pubblici in sola lettura)
create policy "Regimi di mercato consultabili da tutti"
    on public.market_regimes for select using (true);

-- Popolamento Asset Iniziali di Default
insert into public.assets (symbol, name, asset_class, tick_size, default_spread) values
('BTC-USD', 'Bitcoin / US Dollar', 'crypto', 0.01, 5.0),
('ETH-USD', 'Ethereum / US Dollar', 'crypto', 0.01, 0.5),
('^GSPC', 'S&P 500 Index', 'indices', 0.01, 0.25),
('^IXIC', 'Nasdaq Composite', 'indices', 0.01, 0.5),
('EURUSD=X', 'EUR / USD Forex', 'forex', 0.00001, 0.00015),
('GC=F', 'Gold Futures', 'commodities', 0.1, 0.3)
on conflict (symbol) do nothing;
