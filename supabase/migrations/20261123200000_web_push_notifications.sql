create table if not exists public.push_subscriptions (
    endpoint text primary key,
    p256dh text not null,
    auth text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null default gen_random_uuid(),
    device_name text not null default 'Dispositivo',
    platform text not null default 'desktop'
        check (platform in ('iphone', 'android', 'desktop')),
    categories text[] not null default array[
        'news', 'trading_alerts', 'macroeconomy', 'earnings', 'system'
    ]::text[],
    enabled boolean not null default true,
    expiration_time timestamptz,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.push_subscriptions
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists device_id uuid default gen_random_uuid(),
    add column if not exists device_name text not null default 'Dispositivo',
    add column if not exists platform text not null default 'desktop',
    add column if not exists categories text[] not null default array[
        'news', 'trading_alerts', 'macroeconomy', 'earnings', 'system'
    ]::text[],
    add column if not exists enabled boolean not null default true,
    add column if not exists expiration_time timestamptz,
    add column if not exists last_seen_at timestamptz not null default now(),
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set device_id = gen_random_uuid()
where device_id is null;

alter table public.push_subscriptions
    alter column device_id set default gen_random_uuid(),
    alter column device_id set not null;

create unique index if not exists push_subscriptions_endpoint_uidx
    on public.push_subscriptions (endpoint);

create unique index if not exists push_subscriptions_user_device_uidx
    on public.push_subscriptions (user_id, device_id)
    where user_id is not null;

create index if not exists push_subscriptions_enabled_user_idx
    on public.push_subscriptions (enabled, user_id);

do $$
declare
    push_policy record;
begin
    for push_policy in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = 'push_subscriptions'
    loop
        execute format('drop policy %I on public.push_subscriptions', push_policy.policyname);
    end loop;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.push_subscriptions'::regclass
          and conname = 'push_subscriptions_user_id_fkey'
    ) then
        alter table public.push_subscriptions
            add constraint push_subscriptions_user_id_fkey
            foreign key (user_id) references auth.users(id) on delete cascade;
    end if;
end
$$;

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push devices"
    on public.push_subscriptions
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create table if not exists public.news_push_sent (
    news_id text primary key,
    title text not null,
    source_url text,
    published_at timestamptz,
    created_at timestamptz not null default now()
);

alter table public.news_push_sent enable row level security;
revoke all on public.news_push_sent from anon, authenticated;
grant all on public.news_push_sent to service_role;

create table if not exists public.macro_news_sent (
    news_id text primary key,
    title text not null,
    source_url text,
    created_at timestamptz not null default now()
);

alter table public.macro_news_sent enable row level security;
revoke all on public.macro_news_sent from anon, authenticated;
grant all on public.macro_news_sent to service_role;
