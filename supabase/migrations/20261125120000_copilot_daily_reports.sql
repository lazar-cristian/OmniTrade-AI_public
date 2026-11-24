begin;

create table if not exists public.copilot_daily_reports (
    user_id uuid not null references auth.users(id) on delete cascade,
    report_date date not null,
    report_type text not null check (report_type in ('briefing', 'debrief')),
    content text not null,
    created_at timestamptz not null default now(),
    primary key (user_id, report_date, report_type)
);

alter table public.copilot_daily_reports enable row level security;

drop policy if exists "Users manage their own Copilot daily reports"
    on public.copilot_daily_reports;
create policy "Users manage their own Copilot daily reports"
    on public.copilot_daily_reports
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

revoke all on public.copilot_daily_reports from anon;
grant select, insert, update, delete on public.copilot_daily_reports to authenticated;
grant all on public.copilot_daily_reports to service_role;

drop policy if exists "Authenticated users can read active macro events"
    on public.macro_calendar_events;
create policy "Authenticated users can read active macro events"
    on public.macro_calendar_events
    for select
    to authenticated
    using (is_active);
grant select on public.macro_calendar_events to authenticated;

commit;
