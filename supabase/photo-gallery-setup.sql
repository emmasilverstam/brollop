create table if not exists public.photo_delete_tokens (
    photo_path text primary key,
    token_hash text not null,
    created_at timestamptz not null default now()
);

alter table public.photo_delete_tokens enable row level security;
revoke all on table public.photo_delete_tokens from public, anon, authenticated;
grant all on table public.photo_delete_tokens to service_role;

drop policy if exists "Guests can upload wedding photos" on storage.objects;
