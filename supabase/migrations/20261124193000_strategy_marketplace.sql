create table if not exists public.strategy_versions (
    id uuid primary key default gen_random_uuid(),
    strategy_id uuid references public.strategies(id) on delete cascade,
    version_number integer not null default 1,
    changelog text,
    rules_json jsonb not null,
    created_at timestamptz not null default now()
);

create unique index if not exists strategy_versions_strategy_version_uidx
    on public.strategy_versions (strategy_id, version_number);

alter table public.strategy_versions enable row level security;

drop policy if exists "Strategy versions readable by owners and marketplace users"
    on public.strategy_versions;
create policy "Strategy versions readable by owners and marketplace users"
    on public.strategy_versions
    for select
    to anon, authenticated
    using (
        exists (
            select 1
            from public.strategies s
            where s.id = strategy_versions.strategy_id
              and (s.is_public = true or s.user_id = (select auth.uid()))
        )
    );

drop policy if exists "Strategy owners create immutable versions"
    on public.strategy_versions;
create policy "Strategy owners create immutable versions"
    on public.strategy_versions
    for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.strategies s
            where s.id = strategy_versions.strategy_id
              and s.user_id = (select auth.uid())
        )
    );

revoke all on public.strategy_versions from anon, authenticated;
grant select on public.strategy_versions to anon, authenticated;
grant insert on public.strategy_versions to authenticated;

create table if not exists public.strategy_ratings (
    id uuid primary key default gen_random_uuid(),
    strategy_id uuid not null references public.strategies(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    rating smallint not null check (rating between 1 and 5),
    created_at timestamptz not null default now(),
    unique (strategy_id, user_id)
);

create index if not exists strategy_ratings_strategy_idx
    on public.strategy_ratings (strategy_id);

alter table public.strategy_ratings enable row level security;

drop policy if exists "Public strategy ratings are readable"
    on public.strategy_ratings;
create policy "Public strategy ratings are readable"
    on public.strategy_ratings
    for select
    to anon, authenticated
    using (
        exists (
            select 1
            from public.strategies s
            where s.id = strategy_ratings.strategy_id
              and s.is_public = true
        )
    );

drop policy if exists "Users rate public strategies"
    on public.strategy_ratings;
create policy "Users rate public strategies"
    on public.strategy_ratings
    for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and exists (
            select 1
            from public.strategies s
            where s.id = strategy_ratings.strategy_id
              and s.is_public = true
              and s.user_id <> (select auth.uid())
        )
    );

drop policy if exists "Users update their own strategy ratings"
    on public.strategy_ratings;
create policy "Users update their own strategy ratings"
    on public.strategy_ratings
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and exists (
            select 1
            from public.strategies s
            where s.id = strategy_ratings.strategy_id
              and s.is_public = true
              and s.user_id <> (select auth.uid())
        )
    );

drop policy if exists "Users delete their own strategy ratings"
    on public.strategy_ratings;
create policy "Users delete their own strategy ratings"
    on public.strategy_ratings
    for delete
    to authenticated
    using (auth.uid() = user_id);

revoke all on public.strategy_ratings from anon, authenticated;
grant select on public.strategy_ratings to anon, authenticated;
grant insert, update, delete on public.strategy_ratings to authenticated;
