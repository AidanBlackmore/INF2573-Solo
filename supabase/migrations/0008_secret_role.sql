-- Secret role (test). Each time a universe starts (or is replayed), one random
-- player becomes the Murderer. Only that player can read it: the row is
-- invisible to everyone else, including the shared screen, so it never leaves
-- the server for anyone but them. There is no goal or ending reveal yet.

create table public.secret_roles (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  -- The playthrough this role belongs to (rooms.run_start_round).
  run_start_round int not null,
  murderer_player_id uuid not null references public.players (id) on delete cascade
);
create index secret_roles_murderer_idx on public.secret_roles (murderer_player_id);

alter table public.secret_roles enable row level security;
revoke all on public.secret_roles from anon;
revoke insert, update, delete, truncate on public.secret_roles from authenticated;
grant select on public.secret_roles to authenticated;

create policy "the murderer alone can read the role"
  on public.secret_roles for select to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = secret_roles.murderer_player_id and p.user_id = (select auth.uid())
    )
  );

-- A new playthrough (start_universe sets a new run_start_round) picks a new murderer.
create function private.assign_secret_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  select id into v_player from public.players
  where room_id = new.id
  order by random()
  limit 1;
  if v_player is null then
    return new;
  end if;

  insert into public.secret_roles (room_id, run_start_round, murderer_player_id)
  values (new.id, new.run_start_round, v_player)
  on conflict (room_id) do update set
    run_start_round = excluded.run_start_round,
    murderer_player_id = excluded.murderer_player_id;
  return new;
end;
$$;

create trigger rooms_assign_secret_role
  after update of run_start_round on public.rooms
  for each row
  when (new.run_start_round is distinct from old.run_start_round)
  execute function private.assign_secret_role();
