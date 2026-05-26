-- DEV ONLY — DO NOT RUN ON PRODUCTION.
-- Optional: load demo data after 20260427120000_initial_schema.sql
-- Run in SQL Editor (after the migration) if you want parity with the React mock seeds.
-- For production cleanup, use supabase/wipe_demo_data.sql instead.

-- Clear (dev only) — remove or comment this block if you want to keep existing data
truncate table
  public.chat_messages,
  public.conversation_participants,
  public.conversations,
  public.notifications,
  public.ratings,
  public.disputes,
  public.shipments,
  public.transactions,
  public.listings,
  public.users
restart identity cascade;

-- USERS
insert into public.users (id, username, avatar, rating, trades_completed, joined, location, wishlist, wallet_balance, payment_methods, addresses, flag_count) values
  ('u1', 'VinylHunter_Rex', '🦖', 4.9, 47, '2021-03-12', 'New York, NY', array['G.I. Joe','vintage','hasbro']::text[], 1250.00, '[{"id":"pm1","type":"card","last4":"4242","brand":"Visa","expiry":"12/26","isDefault":true},{"id":"pm2","type":"card","last4":"5555","brand":"Mastercard","expiry":"09/25","isDefault":false}]'::jsonb, '[{"id":"a1","label":"Home","name":"Rex Hunter","street":"247 W 35th St","city":"New York","state":"NY","zip":"10001","isDefault":true},{"id":"a2","label":"Work","name":"Rex Hunter","street":"1 Penn Plaza","city":"New York","state":"NY","zip":"10119","isDefault":false}]'::jsonb, 0),
  ('u2', 'RetroPlastic_Joe', '🎖️', 4.7, 23, '2022-01-05', 'Chicago, IL', array['military','vintage']::text[], 340.00, '[{"id":"pm3","type":"card","last4":"1234","brand":"Visa","expiry":"03/27","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u3', 'BotCollector88', '🤖', 5.0, 61, '2020-08-19', 'Austin, TX', array['transformers','boxed']::text[], 820.00, '[{"id":"pm4","type":"paypal","email":"bot88@email.com","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u4', 'KastleGrayskull', '🏰', 4.8, 34, '2021-11-30', 'Los Angeles, CA', array['motu','fantasy']::text[], 95.50, '[]'::jsonb, '[]'::jsonb, 0),
  ('u5', 'DarkSideDave', '🌌', 4.6, 18, '2023-02-14', 'Seattle, WA', array['starwars','kenner']::text[], 2100.00, '[{"id":"pm5","type":"card","last4":"9999","brand":"Amex","expiry":"07/28","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u6', 'ShellShocked_NY', '🐢', 4.9, 55, '2020-06-01', 'Brooklyn, NY', array['tmnt','playmates']::text[], 560.00, '[{"id":"pm6","type":"card","last4":"7777","brand":"Visa","expiry":"11/26","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u7', 'EvilLair_99', '💀', 4.5, 12, '2023-07-22', 'Denver, CO', array['villain','motu']::text[], 75.00, '[]'::jsonb, '[]'::jsonb, 0),
  ('u8', 'CybertronVault', '⚙️', 4.8, 41, '2021-05-10', 'Detroit, MI', array['transformers','decepticon']::text[], 430.00, '[{"id":"pm7","type":"paypal","email":"cybert@vault.com","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u9', 'NinjaArsenal', '🥷', 5.0, 29, '2022-09-03', 'Portland, OR', array['ninja','hasbro']::text[], 190.00, '[{"id":"pm8","type":"card","last4":"3344","brand":"Mastercard","expiry":"05/27","isDefault":true}]'::jsonb, '[]'::jsonb, 0),
  ('u10', 'GalaxySurfer', '🚀', 4.7, 37, '2021-12-25', 'Houston, TX', array['starwars','vintage']::text[], 310.00, '[{"id":"pm9","type":"card","last4":"6677","brand":"Visa","expiry":"02/26","isDefault":true}]'::jsonb, '[]'::jsonb, 0);

-- LISTINGS (figures)
insert into public.listings (id, owner_id, name, brand, line, is_new, value, image, photos, tags, description, wants_trade, wants_buy, listed_at) values
  ('c1',  'u2',  'Snake Eyes (1982 O-Ring)',  'Hasbro',    'G.I. Joe',            false, 220,  '🥷', '[]'::jsonb, array['vintage','hasbro','military']::text[],     null, true,  false, '2024-11-01'),
  ('c2',  'u3',  'Optimus Prime G1 Boxed',   'Hasbro',    'Transformers',         true, 580,  '🤖', '[]'::jsonb, array['vintage','transformers','boxed']::text[],  null, true,  true,  '2024-10-28'),
  ('c3',  'u4',  'He-Man MOTU (1982)',       'Mattel',    'Masters of Universe', false,  95,  '⚔️', '[]'::jsonb, array['vintage','fantasy','motu']::text[],         null, true,  true,  '2024-11-05'),
  ('c4',  'u5',  'Darth Vader (12-back)',   'Kenner',    'Star Wars (Vintage)',  true,1200,  '🌑', '[]'::jsonb, array['starwars','vintage','kenner']::text[],     null, true,  false, '2024-10-15'),
  ('c5',  'u6',  'Leonardo ''88',            'Playmates', 'TMNT',                 false, 310,  '🐢', '[]'::jsonb, array['tmnt','vintage','playmates']::text[],      null, true,  true,  '2024-11-08'),
  ('c6',  'u7',  'Skeletor Battle Armor',   'Mattel',    'Masters of Universe', false, 140,  '💀', '[]'::jsonb, array['vintage','motu','villain']::text[],         null, false, true,  '2024-11-10'),
  ('c7',  'u8',  'Megatron G1 Complete',     'Hasbro',    'Transformers',         false, 420,  '🔫', '[]'::jsonb, array['vintage','transformers','villain']::text[],  null, true,  false, '2024-10-20'),
  ('c8',  'u9',  'Storm Shadow (1984)',     'Hasbro',    'G.I. Joe',            false, 180,  '🤍', '[]'::jsonb, array['vintage','hasbro','ninja']::text[],         null, true,  true,  '2024-11-12'),
  ('c9',  'u10', 'Luke Skywalker Bespin',   'Kenner',    'Star Wars (Vintage)',  false,  85,  '⚡', '[]'::jsonb, array['starwars','vintage','kenner']::text[],      null, true,  true,  '2024-11-03'),
  ('c10', 'u6',  'Raphael Red Variant',     'Playmates', 'TMNT',                 false, 260,  '🍕', '[]'::jsonb, array['tmnt','rare','playmates']::text[],          null, true,  true,  '2024-11-06'),
  ('m1',  'u1',  'Cobra Commander (Hood)',   'Hasbro',    'G.I. Joe',            false, 165,  '🐍', '[]'::jsonb, array['vintage','hasbro','villain']::text[],       null, true,  false, '2024-11-09'),
  ('m2',  'u1',  'Soundwave G1 Complete',    'Hasbro',    'Transformers',         true, 490,  '📻', '[]'::jsonb, array['vintage','transformers']::text[],          null, true,  false, '2024-11-07'),
  ('m3',  'u1',  'Boba Fett (Vintage)',     'Kenner',    'Star Wars (Vintage)',  false, 340,  '🎯', '[]'::jsonb, array['starwars','vintage','kenner']::text[],      null, false, false, '2024-10-30'),
  ('m4',  'u1',  'Michelangelo ''88',        'Playmates', 'TMNT',                 false, 285,  '🟠', '[]'::jsonb, array['tmnt','vintage','playmates']::text[],        null, true,  false, '2024-11-11');

-- TRANSACTIONS
insert into public.transactions (id, type, buyer_id, seller_id, card_id, amount, fee, net, status, method, date, card_name, rated) values
  ('t1', 'purchase', 'u1', 'u3', 'c2', 580,  29.00,  551.00, 'completed',  'wallet',  '2024-10-29', 'Optimus Prime G1 Boxed',  true),
  ('t2', 'sale',     'u4', 'u1', 'm3', 340,  17.00,  323.00, 'completed',  'card',    '2024-11-01', 'Boba Fett (Vintage)',     true),
  ('t3', 'purchase', 'u1', 'u6', 'c5', 310,  10.85, 299.15, 'in_escrow',  'card',    '2024-11-08', 'Leonardo ''88',           false);

-- SHIPMENTS
insert into public.shipments (id, txn_id, tracking_number, carrier, status, estimated_delivery, shipping_cost, from_user, to_user, figure_name, figure_value, funds_released, auto_released, delivered_at, dispute_frozen, events) values
  ('sh1', 't3', '9400111899223397607175', 'USPS Ground', 'in_transit',     '2024-11-14', 14.65, 'u6', 'u1', 'Leonardo ''88', 310, false, false, null, false, $json$[
    {"date":"2024-11-08 14:22", "location":"Brooklyn, NY", "description":"Shipping label created"},
    {"date":"2024-11-09 09:45", "location":"Brooklyn, NY", "description":"Accepted at USPS facility"},
    {"date":"2024-11-10 03:12", "location":"Philadelphia, PA", "description":"In transit to next facility"},
    {"date":"2024-11-11 08:30", "location":"Newark, NJ", "description":"Arrived at USPS facility"}
  ]$json$::jsonb),
  ('sh2', 't1', '9400111899223397512344', 'USPS Ground', 'delivered', '2024-11-01', 19.95, 'u3', 'u1', 'Optimus Prime G1 Boxed', 580, true, true, '2024-11-01T16:55:00.000Z', false, $json$[
    {"date":"2024-10-29 10:00", "location":"Austin, TX", "description":"Shipping label created"},
    {"date":"2024-10-30 11:20", "location":"Austin, TX", "description":"Accepted at USPS facility"},
    {"date":"2024-10-31 06:45", "location":"Dallas, TX", "description":"In transit"},
    {"date":"2024-11-01 14:33", "location":"New York, NY", "description":"Out for delivery"},
    {"date":"2024-11-01 16:55", "location":"New York, NY", "description":"Delivered — Front Door"}
  ]$json$::jsonb);

-- DISPUTES
insert into public.disputes (id, txn_id, raised_by, against_user_id, shipment_id, reason, detail, status, resolution, admin_note, raised_at, resolved_at, figure_value, figure_name, type, against_user) values
  ('d1', 't1', 'u1', 'u3', 'sh2', 'not_as_described', 'Figure had heavy yellowing not shown in listing photos.', 'resolved', 'refund_partial', 'Partial refund of $80 issued. Seller agreed.', '2024-11-02', '2024-11-04', 580, 'Optimus Prime G1 Boxed', 'purchase', 'BotCollector88');

-- RATINGS
insert into public.ratings (id, txn_id, from_user_id, to_user_id, score, comment, type, date) values
  ('r1', 't1', 'u1', 'u3', 4, 'Fast shipper, figure was well packed. Minor yellowing not disclosed.', 'buyer_to_seller', '2024-11-05'),
  ('r2', 't2', 'u4', 'u1', 5, 'Great seller! Figure exactly as described, shipped next day.', 'buyer_to_seller', '2024-11-03');

-- CONVERSATIONS + MESSAGES
insert into public.conversations (id, card_id, card_name, card_image, flag_count) values
  ('th1', 'c2', 'Optimus Prime G1 Boxed', '🤖', 0),
  ('th2', 'c8', 'Storm Shadow (1984)', '🤍', 0),
  ('th3', 'c5', 'Leonardo ''88', '🐢', 0);

insert into public.conversation_participants (conversation_id, user_id) values
  ('th1', 'u1'), ('th1', 'u3'),
  ('th2', 'u1'), ('th2', 'u9'),
  ('th3', 'u1'), ('th3', 'u6');

insert into public.chat_messages (id, conversation_id, from_user_id, body, created_at) values
  ('ch1',  'th1', 'u3', 'Hey! Still interested in the Optimus? Happy to answer any questions.', '2024-10-27T09:12:00+00:00'),
  ('ch2',  'th1', 'u1', 'Yes! Does it have the original trailer and all accessories?',         '2024-10-27T09:45:00+00:00'),
  ('ch3',  'th1', 'u3', 'Complete with trailer, missiles and instructions. Box has some shelf wear but figure is pristine.', '2024-10-27T10:02:00+00:00'),
  ('ch4',  'th1', 'u1', 'Perfect. Going to buy it now 🙌', '2024-10-27T10:15:00+00:00'),
  ('ch5',  'th1', 'u3', 'Great! Will ship same day. Thanks!', '2024-10-27T10:18:00+00:00'),
  ('ch6',  'th2', 'u9', 'I saw you have Cobra Commander — interested in trading for my Storm Shadow?', '2024-11-10T14:30:00+00:00'),
  ('ch7',  'th2', 'u1', 'Definitely interested! Any yellowing on Storm Shadow?',            '2024-11-10T15:00:00+00:00'),
  ('ch8',  'th2', 'u9', 'None at all — kept in a UV-protected case since 1987 🤍',        '2024-11-10T15:22:00+00:00'),
  ('ch9',  'th3', 'u1', 'Hi! Just bought Leonardo. When can you ship?',                     '2024-11-08T18:00:00+00:00'),
  ('ch10', 'th3', 'u6', 'Hey! Will drop it at USPS tomorrow morning 📦',                 '2024-11-08T18:45:00+00:00'),
  ('ch11', 'th3', 'u1', 'Awesome thanks for the quick response!',                    '2024-11-08T18:47:00+00:00');

-- NOTIFICATIONS (inbox for u1 — the demo “current” user)
insert into public.notifications (id, recipient_id, type, is_read, title, body, card_id, link, related_user_id, created_at) values
  ('n1',  'u1', 'wishlist_match',  false, 'Wishlist match!',  'Storm Shadow (1984) just listed — matches your G.I. Joe wishlist tag', 'c8',  'browse',    null,     '2024-11-12T09:00:00+00:00'),
  ('n2',  'u1', 'trade_proposed',  false, 'Trade proposed',   'NinjaArsenal wants to trade Storm Shadow for your Cobra Commander',  null, 'trades',    'u9',     '2024-11-11T18:30:00+00:00'),
  ('n3',  'u1', 'message',         false, 'New message',      'NinjaArsenal: None at all — kept in a UV-protected case since 1987 🤍',  null, 'messages',  'u9',     '2024-11-10T15:22:00+00:00'),
  ('n4',  'u1', 'delivered',        true,  'Package delivered!', 'Leonardo ''88 has been delivered. Funds auto-release in 7 days.',      'c5',  'shipping',  null,     '2024-11-08T16:55:00+00:00'),
  ('n5',  'u1', 'shipped',          true,  'Your item shipped',  'ShellShocked_NY shipped Leonardo ''88 via USPS Ground.',         'c5',  'shipping',  null,     '2024-11-08T10:30:00+00:00'),
  ('n6',  'u1', 'funds_released',   true,  'You''ve been paid!',  '$323.00 from the Boba Fett sale has been released to your wallet.', null, 'wallet',   null,     '2024-11-03T14:00:00+00:00'),
  ('n7',  'u1', 'rated',            true,  'New rating',        'DarkSideDave left you a 5-star rating ⭐⭐⭐⭐⭐',            null, 'account',  'u4',     '2024-11-03T12:00:00+00:00'),
  ('n8',  'u1', 'wishlist_match',   true,  'Wishlist match!',  'Optimus Prime G1 Boxed just listed — matches your vintage wishlist tag', 'c2', 'browse',  null,     '2024-11-01T08:15:00+00:00');
