-- Reference copy. The API also creates these tables automatically on first request.
create table if not exists folders (
  id bigserial primary key,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists folders_name_uq on folders (lower(name));

create table if not exists tasks (
  id bigserial primary key,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  due_date date,
  due_time integer check (due_time between 0 and 1439),
  priority smallint not null default 1 check (priority between 0 and 2),
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id bigserial primary key,
  title text not null default '',
  content jsonb not null default '{"v":1,"blocks":[]}',
  is_pinned boolean not null default false,
  folder_id bigint references folders(id) on delete set null,
  content_format_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_folder_idx on notes (folder_id);

create table if not exists countdowns (
  id bigserial primary key,
  title text not null check (length(btrim(title)) > 0),
  target_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
