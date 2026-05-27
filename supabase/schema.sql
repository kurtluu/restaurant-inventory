-- ============================================================
-- Restaurant Inventory Schema
-- Paste this into Supabase SQL Editor and run it.
-- ============================================================

-- 1. PROFILES (extends Supabase auth.users with role info)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('owner', 'server')),
  phone text, -- only used for owner (SMS recipient)
  created_at timestamptz default now()
);

-- 2. CATEGORIES (produce, meat, dry goods, etc.)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order int default 0,
  created_at timestamptz default now()
);

-- 3. ITEMS (the inventory itself)
create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default 'unit', -- lb, bottle, case, etc.
  quantity numeric not null default 0,
  low_stock_threshold numeric not null default 5,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. STOCK EVENTS (audit trail of every change)
create table public.stock_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  change numeric not null, -- positive (restock) or negative (usage)
  reason text, -- 'usage', 'restock', 'correction', 'flagged_low'
  note text,
  created_at timestamptz default now()
);

-- 5. ALERTS (every low-stock notification sent)
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  triggered_by uuid references public.profiles(id) on delete set null,
  trigger_type text not null check (trigger_type in ('auto_threshold', 'manual_flag')),
  quantity_at_alert numeric,
  message text not null,
  sms_sent boolean default false,
  sms_status text, -- 'mock', 'sent', 'failed'
  acknowledged boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- TRIGGER: keep items.updated_at fresh + auto-create alert
-- when quantity drops below threshold
-- ============================================================

create or replace function public.handle_item_quantity_change()
returns trigger as $$
begin
  new.updated_at := now();

  -- if quantity just crossed below threshold, create an alert
  if new.quantity <= new.low_stock_threshold
     and (old.quantity is null or old.quantity > new.low_stock_threshold) then
    insert into public.alerts (item_id, trigger_type, quantity_at_alert, message, sms_status)
    values (
      new.id,
      'auto_threshold',
      new.quantity,
      new.name || ' is low: ' || new.quantity || ' ' || new.unit || ' remaining (threshold: ' || new.low_stock_threshold || ')',
      'mock'
    );
  end if;

  return new;
end;
$$ language plpgsql;

create trigger items_quantity_change
before update on public.items
for each row execute function public.handle_item_quantity_change();

-- ============================================================
-- TRIGGER: auto-create profile when a user signs up
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'server')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.stock_events enable row level security;
alter table public.alerts enable row level security;

-- helper to check if current user is owner
create or replace function public.is_owner()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$ language sql security definer;

-- profiles: users see their own; owner sees all
create policy "users see own profile" on public.profiles
  for select using (auth.uid() = id or public.is_owner());
create policy "users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- categories: everyone authenticated can read; only owner writes
create policy "auth read categories" on public.categories
  for select using (auth.role() = 'authenticated');
create policy "owner manages categories" on public.categories
  for all using (public.is_owner()) with check (public.is_owner());

-- items: everyone authenticated can read; servers can update quantity, owner does everything
create policy "auth read items" on public.items
  for select using (auth.role() = 'authenticated');
create policy "auth update items" on public.items
  for update using (auth.role() = 'authenticated');
create policy "owner inserts items" on public.items
  for insert with check (public.is_owner());
create policy "owner deletes items" on public.items
  for delete using (public.is_owner());

-- stock_events: everyone authenticated reads + inserts their own
create policy "auth read events" on public.stock_events
  for select using (auth.role() = 'authenticated');
create policy "auth insert events" on public.stock_events
  for insert with check (auth.uid() = user_id);

-- alerts: everyone reads; servers insert manual flags; owner updates (acknowledge)
create policy "auth read alerts" on public.alerts
  for select using (auth.role() = 'authenticated');
create policy "auth insert alerts" on public.alerts
  for insert with check (auth.role() = 'authenticated');
create policy "owner updates alerts" on public.alerts
  for update using (public.is_owner());

-- ============================================================
-- SEED DATA: a few categories + sample items so dashboard isn't empty
-- ============================================================

insert into public.categories (name, display_order) values
  ('Produce', 1),
  ('Meat & Seafood', 2),
  ('Dairy', 3),
  ('Dry Goods', 4),
  ('Alcohol', 5),
  ('Beverages', 6);

insert into public.items (name, category_id, unit, quantity, low_stock_threshold) values
  ('Tomatoes', (select id from public.categories where name = 'Produce'), 'lb', 25, 10),
  ('Romaine Lettuce', (select id from public.categories where name = 'Produce'), 'head', 12, 6),
  ('Chicken Breast', (select id from public.categories where name = 'Meat & Seafood'), 'lb', 40, 15),
  ('Ground Beef', (select id from public.categories where name = 'Meat & Seafood'), 'lb', 30, 10),
  ('Whole Milk', (select id from public.categories where name = 'Dairy'), 'gallon', 8, 4),
  ('Olive Oil', (select id from public.categories where name = 'Dry Goods'), 'bottle', 6, 2),
  ('House Red Wine', (select id from public.categories where name = 'Alcohol'), 'bottle', 24, 6),
  ('Sparkling Water', (select id from public.categories where name = 'Beverages'), 'case', 4, 2);
