begin;

create table if not exists public.journals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    trade_id uuid references public.trades(id) on delete set null,
    ticker text not null,
    timeframe text not null default '',
    session_tag text,
    entry_price numeric(14,6),
    exit_price numeric(14,6),
    pnl numeric(14,2),
    emotional_state text check (emotional_state in ('Disciplinato', 'Calmo', 'Ansioso', 'FOMO', 'Euforico', 'Frustrato', 'Non Specificato')),
    mistake_tag text,
    notes text,
    screenshot_url text,
    ai_feedback text,
    created_at timestamptz not null default now()
);

alter table public.journals
    add column if not exists direction text,
    add column if not exists strategy_name text,
    add column if not exists entry_time timestamptz,
    add column if not exists stop_loss numeric(14,6),
    add column if not exists take_profit numeric(14,6),
    add column if not exists risk_reward numeric(8,3),
    add column if not exists result text;

update public.journals
set entry_time = coalesce(entry_time, created_at, now()),
    result = coalesce(
        result,
        case
            when pnl > 0 then 'win'
            when pnl < 0 then 'loss'
            when pnl = 0 and exit_price is not null then 'breakeven'
            else 'open'
        end
    );

alter table public.journals
    alter column entry_time set default now(),
    alter column entry_time set not null,
    alter column result set default 'open',
    alter column result set not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.journals'::regclass and conname = 'journals_direction_check') then
        alter table public.journals add constraint journals_direction_check
            check (direction is null or direction in ('long', 'short'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.journals'::regclass and conname = 'journals_result_check') then
        alter table public.journals add constraint journals_result_check
            check (result in ('open', 'win', 'loss', 'breakeven'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.journals'::regclass and conname = 'journals_risk_reward_check') then
        alter table public.journals add constraint journals_risk_reward_check
            check (risk_reward is null or risk_reward > 0);
    end if;
end
$$;

create index if not exists journals_user_entry_time_idx
    on public.journals (user_id, entry_time desc);

alter table public.journals enable row level security;
drop policy if exists "Gli utenti visualizzano e gestiscono il proprio diario"
    on public.journals;
drop policy if exists "Users manage their own journal entries"
    on public.journals;
create policy "Users manage their own journal entries"
    on public.journals
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

revoke all on public.journals from anon;
grant select, insert, update, delete on public.journals to authenticated;
grant all on public.journals to service_role;

alter table public.push_subscriptions
    alter column categories set default array[
        'news', 'trading_alerts', 'macroeconomy', 'earnings', 'system',
        'portfolio', 'journal', 'backtest'
    ]::text[];

create table if not exists public.macro_calendar_events (
    id text primary key,
    title text not null,
    currency text,
    impact text not null check (impact in ('high', 'medium', 'low')),
    event_at timestamptz not null,
    source_url text,
    is_active boolean not null default true,
    updated_at timestamptz not null default now()
);

create index if not exists macro_calendar_events_active_time_idx
    on public.macro_calendar_events (event_at)
    where is_active and impact = 'high';

alter table public.macro_calendar_events enable row level security;
revoke all on public.macro_calendar_events from anon, authenticated;
grant all on public.macro_calendar_events to service_role;

create table if not exists public.macro_event_reminders (
    event_id text not null references public.macro_calendar_events(id) on delete cascade,
    reminder_minutes smallint not null check (reminder_minutes in (30, 5)),
    status text not null default 'processing' check (status in ('processing', 'sent')),
    claimed_at timestamptz not null default now(),
    sent_at timestamptz,
    primary key (event_id, reminder_minutes)
);

alter table public.macro_event_reminders enable row level security;
revoke all on public.macro_event_reminders from anon, authenticated;
grant all on public.macro_event_reminders to service_role;

create or replace function public.claim_macro_event_reminder(
    p_event_id text,
    p_reminder_minutes smallint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    claimed_event_id text;
begin
    insert into public.macro_event_reminders (event_id, reminder_minutes, status, claimed_at)
    values (p_event_id, p_reminder_minutes, 'processing', now())
    on conflict (event_id, reminder_minutes) do update
        set status = 'processing', claimed_at = now()
        where macro_event_reminders.status = 'processing'
          and macro_event_reminders.claimed_at < now() - interval '2 minutes'
    returning event_id into claimed_event_id;

    return claimed_event_id is not null;
end
$$;

revoke all on function public.claim_macro_event_reminder(text, smallint) from public, anon, authenticated;
grant execute on function public.claim_macro_event_reminder(text, smallint) to service_role;

commit;
