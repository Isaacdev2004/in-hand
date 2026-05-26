-- ============================================================================
-- Wipe demo / seed data from In Hand Supabase database.
-- Run this once in the Supabase SQL Editor for the PRODUCTION project to
-- delete the demo users (u1..u10), demo listings (c1..c10, m1..m4), and all
-- related rows. Real users created via auth (uuid ids) and their listings
-- are NOT touched.
-- ============================================================================

begin;

-- Temp tables holding the demo ids (a CTE only scopes to one statement,
-- so we use temp tables that all DELETEs below can reference).
create temp table demo_users (id text primary key) on commit drop;
insert into demo_users (id) values
  ('u1'),('u2'),('u3'),('u4'),('u5'),
  ('u6'),('u7'),('u8'),('u9'),('u10');

create temp table demo_listings (id text primary key) on commit drop;
insert into demo_listings (id) values
  ('c1'),('c2'),('c3'),('c4'),('c5'),
  ('c6'),('c7'),('c8'),('c9'),('c10'),
  ('m1'),('m2'),('m3'),('m4');

-- chat_messages -> conversation_participants -> conversations
delete from public.chat_messages
  where conversation_id in (
    select c.id from public.conversations c
    where c.card_id in (select id from demo_listings)
       or exists (
         select 1 from public.conversation_participants p
         where p.conversation_id = c.id
           and p.user_id in (select id from demo_users)
       )
  );

delete from public.conversation_participants
  where user_id in (select id from demo_users)
     or conversation_id in (
       select id from public.conversations
       where card_id in (select id from demo_listings)
     );

delete from public.conversations
  where card_id in (select id from demo_listings)
     or id not in (select distinct conversation_id from public.conversation_participants);

delete from public.notifications
  where recipient_id in (select id from demo_users)
     or related_user_id in (select id from demo_users)
     or card_id in (select id from demo_listings);

delete from public.ratings
  where from_user_id in (select id from demo_users)
     or to_user_id in (select id from demo_users);

delete from public.disputes
  where raised_by in (select id from demo_users)
     or against_user_id in (select id from demo_users);

delete from public.shipments
  where from_user in (select id from demo_users)
     or to_user in (select id from demo_users)
     or txn_id in (
       select id from public.transactions
       where buyer_id in (select id from demo_users)
          or seller_id in (select id from demo_users)
     );

delete from public.transactions
  where buyer_id in (select id from demo_users)
     or seller_id in (select id from demo_users)
     or card_id in (select id from demo_listings);

delete from public.listings
  where id in (select id from demo_listings)
     or owner_id in (select id from demo_users);

delete from public.users
  where id in (select id from demo_users);

commit;

-- Sanity check — should all be 0 (or just real auth-created rows)
select 'users' as t, count(*) from public.users
union all select 'listings', count(*) from public.listings
union all select 'transactions', count(*) from public.transactions
union all select 'shipments', count(*) from public.shipments
union all select 'disputes', count(*) from public.disputes
union all select 'ratings', count(*) from public.ratings
union all select 'conversations', count(*) from public.conversations
union all select 'chat_messages', count(*) from public.chat_messages
union all select 'notifications', count(*) from public.notifications;
