create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 60),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000000),
  category text not null check (category in ('Food','Transport','Shopping','Bills','Entertainment','Health','Education','Travel','Other')),
  payment_method text not null check (payment_method in ('Cash','Debit Card','Credit Card','Bank Transfer','Digital Wallet')),
  date date not null,
  notes text not null default '' check (char_length(notes) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc, created_at desc);

create or replace function public.set_expenses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_expenses_updated_at();

create or replace function public.reject_future_expense_date()
returns trigger
language plpgsql
as $$
begin
  if new.date > current_date then
    raise exception 'Expense date cannot be in the future';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_reject_future_date on public.expenses;
create trigger expenses_reject_future_date
before insert or update on public.expenses
for each row execute function public.reject_future_expense_date();

alter table public.expenses enable row level security;

drop policy if exists "Users can view their own expenses" on public.expenses;
drop policy if exists "Users can insert their own expenses" on public.expenses;
drop policy if exists "Users can update their own expenses" on public.expenses;
drop policy if exists "Users can delete their own expenses" on public.expenses;

create policy "Users can view their own expenses"
on public.expenses
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own expenses"
on public.expenses
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own expenses"
on public.expenses
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own expenses"
on public.expenses
for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.expenses to authenticated;
revoke all on public.expenses from anon;
