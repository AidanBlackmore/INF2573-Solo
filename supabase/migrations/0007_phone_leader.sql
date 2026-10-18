-- Phone leader. The first player to join a room runs the game from their
-- phone: start a universe, reveal, re-vote, pick a tie, next act, replay. The
-- laptop that created the room can still do all of it, as a backup.
--
-- Every game-control function checks permission through
-- private.lock_room_as_host, so widening that one check covers them all.
-- reveal_now predates it and had its own check, so it now uses it too.

-- True if the current user is the room's first player (earliest to join).
-- The app uses the same rule (roomLeader in lib/game.ts).
create function private.is_room_leader(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.id = (
      select first.id
      from public.players first
      where first.room_id = p_room_id
      order by first.created_at, first.id
      limit 1
    )
    and p.user_id = auth.uid()
  );
$$;

create or replace function private.lock_room_as_host(p_room_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Room not found';
  end if;
  if v_room.host_id is distinct from auth.uid() and not private.is_room_leader(p_room_id) then
    raise exception 'Only the first player or the shared screen can do that';
  end if;
  return v_room;
end;
$$;

create or replace function public.reveal_now(p_room_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  v_room := private.lock_room_as_host(p_room_id);
  if v_room.phase <> 'choosing' then
    raise exception 'There is no round to reveal';
  end if;

  update public.rooms set phase = 'revealed' where id = p_room_id
  returning * into v_room;
  return v_room;
end;
$$;
