-- Schéma Supabase prévu pour la version synchronisée
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists household_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('shopping','task','event','home','note','buy')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  done boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table household_items enable row level security;
alter table messages enable row level security;

-- Les politiques RLS définitives seront verrouillées à 2 comptes lors de la connexion Supabase.
