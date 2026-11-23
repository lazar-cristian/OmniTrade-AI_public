begin;

drop policy if exists "Gli utenti gestiscono le proprie strategie o leggono quelle pubbliche"
    on public.strategies;
drop policy if exists strategies_public_read on public.strategies;
drop policy if exists strategies_owner_insert on public.strategies;
drop policy if exists strategies_owner_update on public.strategies;
drop policy if exists strategies_owner_delete on public.strategies;

create policy strategies_public_read
    on public.strategies for select to anon, authenticated
    using (auth.uid() = user_id or is_public = true);

create policy strategies_owner_insert
    on public.strategies for insert to authenticated
    with check (auth.uid() = user_id);

create policy strategies_owner_update
    on public.strategies for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy strategies_owner_delete
    on public.strategies for delete to authenticated
    using (auth.uid() = user_id);

commit;
