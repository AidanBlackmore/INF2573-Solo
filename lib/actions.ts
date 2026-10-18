import type { Universe } from "@/content/universes";
import { eventPart, track } from "./analytics";
import { actConfig, currentUniverse, type Room } from "./game";
import { supabase } from "./supabase";

// Moving the story forward. The leader's phone runs these, and the shared
// screen can too as a backup; the database checks who is allowed.

async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw error;
}

export async function startUniverse(room: Room, universe: Universe, isReplay = false) {
  await rpc("start_universe", { p_room_id: room.id, p_universe_id: universe.id, ...actConfig(universe.acts[0]) });
  if (!isReplay) {
    track("universe_selected", { universe_id: universe.id });
    // One event per universe, e.g. universe_selected_mall_night.
    track(`universe_selected_${eventPart(universe.id)}`, { universe_id: universe.id });
  }
  trackRoundStarted(universe, 1);
}

// The next act, or the ending after the last one.
export async function nextAct(room: Room) {
  const universe = currentUniverse(room);
  if (!universe) return;
  const next = universe.acts[room.act];
  if (!next) {
    await rpc("end_universe", { p_room_id: room.id });
    return;
  }
  await rpc("next_act", { p_room_id: room.id, ...actConfig(next) });
  trackRoundStarted(universe, room.act + 1);
}

export const revealNow = (room: Room) => rpc("reveal_now", { p_room_id: room.id });

export const startRevote = (room: Room, tied: string[]) =>
  rpc("start_revote", { p_room_id: room.id, p_tied: tied });

export const resolveTie = (room: Room, pick: string) => rpc("resolve_tie", { p_room_id: room.id, p_pick: pick });

export const backToPicker = (room: Room) => rpc("back_to_picker", { p_room_id: room.id });

// One event name per round, so each round is its own step in PostHog:
// round_1_started, round_2_started… up to the number of acts in the universe.
function trackRoundStarted(universe: Universe, round: number) {
  track(`round_${round}_started`, {
    universe_id: universe.id,
    round,
    total_rounds: universe.acts.length,
  });
}
