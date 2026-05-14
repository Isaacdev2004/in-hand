-- Trade vs purchase disputes + denormalized counterparty label (v1.2)
alter table public.disputes add column if not exists type text not null default 'purchase';
alter table public.disputes add column if not exists against_user text;

comment on column public.disputes.type is 'purchase | trade — how the dispute should be routed.';
comment on column public.disputes.against_user is 'Counterparty username at filing time (denormalized for admin UI).';