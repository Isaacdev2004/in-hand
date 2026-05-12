-- Dev-friendly RLS policies for write paths migrated in this step:
-- transactions, shipments, messaging, disputes, ratings.
-- Tighten after auth migration (replace broad policies with auth.uid()-scoped rules).

alter table public.transactions enable row level security;
alter table public.shipments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.disputes enable row level security;
alter table public.ratings enable row level security;

-- transactions
drop policy if exists "transactions_all_dev" on public.transactions;
create policy "transactions_all_dev" on public.transactions
for all to anon, authenticated
using (true) with check (true);

-- shipments
drop policy if exists "shipments_all_dev" on public.shipments;
create policy "shipments_all_dev" on public.shipments
for all to anon, authenticated
using (true) with check (true);

-- conversations
drop policy if exists "conversations_all_dev" on public.conversations;
create policy "conversations_all_dev" on public.conversations
for all to anon, authenticated
using (true) with check (true);

drop policy if exists "conversation_participants_all_dev" on public.conversation_participants;
create policy "conversation_participants_all_dev" on public.conversation_participants
for all to anon, authenticated
using (true) with check (true);

drop policy if exists "chat_messages_all_dev" on public.chat_messages;
create policy "chat_messages_all_dev" on public.chat_messages
for all to anon, authenticated
using (true) with check (true);

-- disputes + ratings
drop policy if exists "disputes_all_dev" on public.disputes;
create policy "disputes_all_dev" on public.disputes
for all to anon, authenticated
using (true) with check (true);

drop policy if exists "ratings_all_dev" on public.ratings;
create policy "ratings_all_dev" on public.ratings
for all to anon, authenticated
using (true) with check (true);
