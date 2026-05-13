-- public.users: RLS policies for Supabase Auth (auth.users.id = public.users.id as text).
-- Fixes 403 on GET/POST /rest/v1/users when RLS is on without usable policies.
-- Aligns with authSession.js (select self or all for load; insert own row on first sign-in)
-- and databaseToAppState.js (select * for marketplace).

alter table public.users enable row level security;

drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
on public.users
for select
to authenticated
using (true);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
on public.users
for insert
to authenticated
with check (id = (select auth.uid())::text);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
on public.users
for update
to authenticated
using (id = (select auth.uid())::text)
with check (id = (select auth.uid())::text);
