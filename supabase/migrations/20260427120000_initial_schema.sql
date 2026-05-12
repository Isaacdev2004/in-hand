-- In Hand — collector marketplace
-- Initial schema: mirrors the React app’s in-memory / JSON shape (text ids: u1, c1, …) for a smooth first integration.
-- Apply in Supabase: SQL Editor → New query → paste → Run, or: supabase db push (if using Supabase CLI).

-- ─── USERS ───────────────────────────────────────────────────────────────────
-- profile + wallet; payment_methods & addresses are JSON (matches app)
create table if not exists public.users (
  id                text primary key,
  username          text not null,
  avatar            text,
  rating            numeric(3,1)  not null default 5.0,
  trades_completed  integer       not null default 0,
  joined            date,
  location          text,
  wishlist          text[]        not null default '{}',
  wallet_balance    numeric(12,2) not null default 0,
  payment_methods   jsonb         not null default '[]',
  addresses         jsonb         not null default '[]',
  flag_count        integer       not null default 0,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists users_username_lower on public.users (lower(username));

-- listings (app calls these "cards")
create table if not exists public.listings (
  id            text primary key,
  owner_id      text        not null references public.users (id) on delete cascade,
  name          text        not null,
  brand         text        not null,
  line          text        not null,
  is_new        boolean     not null default true,
  value         numeric(12,2) not null,
  image         text,
  photos        jsonb       not null default '[]',
  tags          text[]      not null default '{}',
  description   text,
  wants_trade   boolean     not null default true,
  wants_buy     boolean     not null default false,
  listed_at     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists listings_owner_id  on public.listings (owner_id);
create index if not exists listings_line      on public.listings (line);
create index if not exists listings_wants     on public.listings (wants_trade, wants_buy);

-- purchases, trades, sweeteners, top-ups, …
create table if not exists public.transactions (
  id          text primary key,
  type        text not null,
  buyer_id    text not null references public.users (id),
  seller_id   text not null references public.users (id),
  card_id     text references public.listings (id) on delete set null,
  amount      numeric(12,2) not null,
  fee         numeric(12,2) not null default 0,
  net         numeric(12,2) not null default 0,
  status      text not null,
  method      text,
  date        date,
  card_name   text,
  rated       boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists tx_buyer  on public.transactions (buyer_id);
create index if not exists tx_seller on public.transactions (seller_id);
create index if not exists tx_status on public.transactions (status);

-- shipping + escrow state (events JSON: [{ date, location, description }])
create table if not exists public.shipments (
  id                  text primary key,
  txn_id              text not null references public.transactions (id) on delete cascade,
  tracking_number     text not null default '',
  carrier             text,
  status              text not null,
  estimated_delivery  text,
  shipping_cost       numeric(12,2),
  shipping_label      text,
  from_user           text not null references public.users (id),
  to_user             text not null references public.users (id),
  figure_name         text,
  figure_value        numeric(12,2),
  funds_released      boolean not null default false,
  auto_released       boolean not null default false,
  delivered_at        timestamptz,
  dispute_frozen      boolean not null default false,
  events              jsonb not null default '[]',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ship_txn  on public.shipments (txn_id);
create index if not exists ship_from on public.shipments (from_user);
create index if not exists ship_to   on public.shipments (to_user);

-- disputes
create table if not exists public.disputes (
  id               text primary key,
  txn_id           text not null references public.transactions (id) on delete cascade,
  raised_by        text not null references public.users (id),
  against_user_id  text not null references public.users (id),
  shipment_id      text references public.shipments (id) on delete set null,
  reason           text not null,
  detail           text,
  status           text not null default 'open',
  resolution       text,
  admin_note       text,
  raised_at        date,
  resolved_at      date,
  figure_value     numeric(12,2),
  figure_name      text,
  created_at       timestamptz not null default now()
);

create index if not exists disputes_status on public.disputes (status);
create index if not exists disputes_txn    on public.disputes (txn_id);

-- post-trade ratings
create table if not exists public.ratings (
  id            text primary key,
  txn_id        text not null references public.transactions (id) on delete cascade,
  from_user_id  text not null references public.users (id),
  to_user_id    text not null references public.users (id),
  score         smallint not null,
  comment       text,
  type          text,
  date          date,
  created_at    timestamptz not null default now()
);

create index if not exists ratings_to on public.ratings (to_user_id);

-- messages: one row per thread + participants + chat rows (replaces embedded arrays in JSON)
create table if not exists public.conversations (
  id          text primary key,
  card_id     text references public.listings (id) on delete set null,
  card_name   text,
  card_image  text,
  flag_count  integer     not null default 0,
  flags       jsonb       not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id  text not null references public.conversations (id) on delete cascade,
  user_id          text not null references public.users (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.chat_messages (
  id                text primary key,
  conversation_id   text not null references public.conversations (id) on delete cascade,
  from_user_id      text not null references public.users (id),
  body              text not null,
  created_at        timestamptz not null default now()
);

create index if not exists chat_conv on public.chat_messages (conversation_id, created_at);

-- in-app + push targets (recipient = who sees it; mock data had a single global list — this fixes that)
create table if not exists public.notifications (
  id                text primary key,
  recipient_id      text not null references public.users (id) on delete cascade,
  type              text not null,
  is_read           boolean not null default false,
  title             text,
  body              text,
  card_id           text references public.listings (id) on delete set null,
  link              text,
  related_user_id   text references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists notif_recipient_unread on public.notifications (recipient_id, is_read);

-- RLS: leave OFF for local/dev until you wire auth.uid() to public.users.
-- When ready: enable RLS and replace with real policies; never trust the anon key in production
-- for privileged writes (use Edge Functions with service role for admin/disputes).

comment on table public.users is 'Collector profile; id aligns with app seed (u1…) until you migrate to auth.users UUID.';
comment on table public.listings is 'Marketplace listings; app name "cards".';
comment on table public.conversations is 'Replaces the old "messages" array-of-threads JSON blob.';
