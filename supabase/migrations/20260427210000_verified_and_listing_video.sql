-- Verified sellers + optional listing short video URL
alter table public.users add column if not exists verified boolean not null default false;
alter table public.listings add column if not exists video_url text;

comment on column public.users.verified is 'In Hand verified seller (set by admin / ops; not self-service).';
comment on column public.listings.video_url is 'Optional short clip: YouTube/Vimeo URL or direct mp4/webm link.';
