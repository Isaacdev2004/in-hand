-- Listings RLS (dev-friendly): enables row-level security and allows CRUD
-- for anon/authenticated while auth migration is still in progress.
-- Tighten these policies after Supabase Auth is wired.

alter table public.listings enable row level security;

drop policy if exists "listings_select_all_dev" on public.listings;
create policy "listings_select_all_dev"
on public.listings
for select
to anon, authenticated
using (true);

drop policy if exists "listings_insert_all_dev" on public.listings;
create policy "listings_insert_all_dev"
on public.listings
for insert
to anon, authenticated
with check (true);

drop policy if exists "listings_update_all_dev" on public.listings;
create policy "listings_update_all_dev"
on public.listings
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "listings_delete_all_dev" on public.listings;
create policy "listings_delete_all_dev"
on public.listings
for delete
to anon, authenticated
using (true);
