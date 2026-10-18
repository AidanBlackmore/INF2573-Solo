"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckIcon } from "../../check-icon";
import { KnifeIcon } from "../../knife-icon";
import { UNIVERSES, isPlayable } from "@/content/universes";
import { track } from "@/lib/analytics";
import { backToPicker, nextAct, resolveTie, revealNow, startRevote, startUniverse } from "@/lib/actions";
import {
  MIN_PLAYERS,
  actOutcome,
  candidatesFor,
  currentAct,
  currentUniverse,
  hasSubmitted,
  resolveAct,
  roomLeader,
  universeVotes,
  type Choice,
  type Player,
  type Room,
} from "@/lib/game";
import { ensureSignedIn, errorMessage, supabase } from "@/lib/supabase";
import { useRoom } from "@/lib/useRoom";
import { formatSeconds, useSecondsLeft } from "@/lib/useSecondsLeft";

type Status = "loading" | "not-found" | "error" | "ready";

export default function PlayerScreen() {
  const { code } = useParams<{ code: string }>();
  const roomCode = decodeURIComponent(code).trim().toUpperCase();

  const [status, setStatus] = useState<Status>("loading");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Find the room, and whether this device has already joined it (reconnect).
  useEffect(() => {
    (async () => {
      try {
        const userId = await ensureSignedIn();
        const { data: room } = await supabase
          .from("rooms")
          .select("id")
          .eq("code", roomCode)
          .maybeSingle();
        if (!room) {
          setStatus("not-found");
          return;
        }
        const { data: me } = await supabase
          .from("players")
          .select("id")
          .eq("room_id", room.id)
          .eq("user_id", userId)
          .maybeSingle();
        setRoomId(room.id);
        setMyPlayerId(me?.id ?? null);
        setStatus("ready");
      } catch (e) {
        setError(errorMessage(e));
        setStatus("error");
      }
    })();
  }, [roomCode]);

  if (status === "loading") return <PhoneShell />;

  if (status === "not-found" || status === "error") {
    return (
      <PhoneShell>
        <Message
          title={status === "not-found" ? `No room called ${roomCode}` : "Could not connect"}
          body={error ?? "Check the code on the shared screen and try again."}
        />
        <Link href="/" className={primaryButton}>
          Enter another code
        </Link>
      </PhoneShell>
    );
  }

  if (!myPlayerId) {
    return <JoinForm roomCode={roomCode} onJoined={setMyPlayerId} />;
  }

  return <Controller roomId={roomId!} roomCode={roomCode} myPlayerId={myPlayerId} />;
}

function JoinForm({ roomCode, onJoined }: { roomCode: string; onJoined: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("join_room", { p_code: roomCode, p_name: name });
    setBusy(false);
    if (error) setError(error.message);
    else onJoined(data.id);
  }

  return (
    <PhoneShell roomCode={roomCode}>
      <form onSubmit={join} className="flex flex-1 flex-col gap-4">
        <label htmlFor="name" className="text-3xl font-semibold">
          What should we call you?
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete="off"
          autoFocus
          placeholder="Your name"
          className="h-16 rounded-2xl border border-stone-300 bg-white px-5 text-2xl outline-none focus:border-stone-900"
        />
        {error && <p className="text-lg text-red-600">{error}</p>}
        <button type="submit" disabled={busy || !name.trim()} className={`${primaryButton} mt-auto`}>
          {busy ? "Joining…" : "Join"}
        </button>
      </form>
    </PhoneShell>
  );
}

function Controller({
  roomId,
  roomCode,
  myPlayerId,
}: {
  roomId: string;
  roomCode: string;
  myPlayerId: string;
}) {
  const { room, players, choices, reload } = useRoom(roomId);
  // Selections and local submit state are tied to a round, so they reset
  // automatically when the host starts the next act.
  const [selection, setSelection] = useState<{ step: string; key: string } | null>(null);
  const [submittedStep, setSubmittedStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useSecondsLeft(room?.phase === "choosing" ? room.choice_deadline : null);
  const opensIn = useSecondsLeft(room?.phase === "choosing" ? room.choices_open_at : null);
  // Everyone reads the scenario and talks before anyone can choose.
  const discussing = opensIn !== null && opensIn > 0;
  const isMurderer = useIsMurderer(room);

  const me = players.find((p) => p.id === myPlayerId);
  if (!room || !me) return <PhoneShell roomCode={roomCode} />;

  // The first player to join moves the story forward from their phone.
  const leader = roomLeader(players);
  const isLeader = leader?.id === me.id;
  const leaderControls = isLeader && (
    <LeaderControls room={room} players={players} choices={choices} secondsLeft={secondsLeft} onDone={reload} />
  );

  const universe = currentUniverse(room);
  const act = currentAct(room);
  // A "step" is one vote: the act's vote, or its tie-break re-vote.
  const step = `${room.round}:${room.stage}`;
  const selected = selection?.step === step ? selection.key : null;
  const submitted = hasSubmitted(me, room) || submittedStep === step;
  const isRevote = room.stage === 1;
  const candidates = act
    ? candidatesFor(act, players).filter((c) => !isRevote || room.tie_options.includes(c.key))
    : [];

  async function submit() {
    if (!room || !act || !selected || busy || discussing) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(
      "submit_choice",
      act.kind === "player"
        ? { p_room_id: room.id, p_chosen_player_id: selected }
        : { p_room_id: room.id, p_chosen_option: selected },
    );
    if (error) setError(error.message);
    else {
      setSubmittedStep(step);
      track("vote_submitted", {
        universe_id: universe?.id,
        round: room.act,
        total_rounds: universe?.acts.length,
        stage: isRevote ? "revote" : "vote",
        act_kind: act.kind,
      });
    }
    await reload();
    setBusy(false);
  }

  return (
    <PhoneShell roomCode={roomCode} name={me.name}>
      {room.phase !== "lobby" && isMurderer !== null && <RoleCard isMurderer={isMurderer} />}

      {room.phase === "lobby" && (
        <UniverseVote
          roomId={room.id}
          current={me.universe_vote}
          onVoted={reload}
          footer={
            leaderControls || (
              <p className="text-center text-base text-stone-500">
                The game starts when {leader?.name ?? "the first player"} taps Start.
              </p>
            )
          }
        />
      )}

      {room.phase === "choosing" && submitted && (
        <>
          <Message title="Waiting for others…" body="Your choice is locked in and kept secret." />
          {leaderControls}
        </>
      )}

      {room.phase === "choosing" && !submitted && secondsLeft === 0 && (
        <Message title="Time's up" body="A random choice is being made for you." />
      )}

      {room.phase === "choosing" && !submitted && secondsLeft !== 0 && universe && act && (
        <div className="flex flex-1 flex-col gap-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium uppercase tracking-widest text-stone-500">
              {universe.title} · Act {room.act} · {isRevote ? "Tie-break vote" : act.title}
            </p>
            {discussing ? (
              <span className="text-xl font-semibold tabular-nums text-amber-600">{formatSeconds(opensIn)}</span>
            ) : (
              secondsLeft !== null && (
                <span
                  className={`text-xl font-semibold tabular-nums ${secondsLeft <= 10 ? "text-red-600" : "text-stone-900"}`}
                >
                  {formatSeconds(secondsLeft)}
                </span>
              )
            )}
          </div>
          {isRevote ? (
            <p className="text-lg leading-snug text-stone-700">
              It&apos;s a tie. Vote again, choosing only between the tied answers.
            </p>
          ) : (
            <p className="text-lg leading-snug text-stone-700">{act.scenario}</p>
          )}
          {discussing ? (
            <p className="rounded-2xl bg-amber-100 px-4 py-3 text-lg font-medium text-amber-900">
              Talk it over with the group first. You can choose in {opensIn} second{opensIn === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="text-2xl font-semibold">
              {act.kind === "player" ? "Pick one person." : "Pick one option."}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {candidates.map((c) => {
              const isSelected = c.key === selected;
              return (
                <li key={c.key}>
                  <button
                    onClick={() => setSelection({ step, key: c.key })}
                    disabled={discussing}
                    aria-pressed={isSelected}
                    className={`flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl border-2 px-5 py-3 text-left text-xl font-medium disabled:opacity-50 ${
                      isSelected
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-300 bg-white"
                    }`}
                  >
                    <span>
                      {c.label}
                      {c.key === me.id && <span className="ml-2 text-base opacity-60">(you)</span>}
                    </span>
                    {isSelected && <CheckIcon className="h-7 w-7 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p className="text-lg text-red-600">{error}</p>}
          <button
            onClick={submit}
            disabled={!selected || busy || discussing}
            className={`${primaryButton} sticky bottom-6 mt-auto`}
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      )}

      {room.phase === "revealed" && (
        <>
          <Message title="Choices revealed" body="Look at the shared screen." />
          {leaderControls}
        </>
      )}

      {room.phase === "ended" && (
        <>
          <Message
            title={`The end of ${universe?.title ?? "this universe"}`}
            body="Look at the shared screen and talk it over."
          />
          {leaderControls}
        </>
      )}
    </PhoneShell>
  );
}

function UniverseVote({
  roomId,
  current,
  onVoted,
  footer,
}: {
  roomId: string;
  current: string | null;
  onVoted: () => Promise<void>;
  footer: React.ReactNode;
}) {
  // Shown right away on tap, before the database confirms.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voted = pending ?? current;

  async function vote(universeId: string) {
    setPending(universeId);
    setError(null);
    const { error } = await supabase.rpc("vote_universe", { p_room_id: roomId, p_universe_id: universeId });
    if (error) setError(error.message);
    else track("universe_vote_cast", { universe_id: universeId });
    await onVoted();
    setPending(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Vote for a universe</h1>
        <p className="mt-1 text-lg text-stone-600">
          {voted ? "You can change your vote until the game starts." : "Tap the one you want to play."}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {UNIVERSES.map((u) => {
          const playable = isPlayable(u);
          const isVoted = playable && u.id === voted;
          return (
            <li key={u.id}>
              <button
                onClick={() => vote(u.id)}
                disabled={!playable}
                aria-pressed={isVoted}
                className={`flex w-full items-start justify-between gap-4 rounded-2xl border-2 px-5 py-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
                  isVoted ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"
                }`}
              >
                <span className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-widest opacity-60">
                    {u.tone}
                    {!playable && " · Coming soon"}
                  </span>
                  <span className="text-2xl font-semibold">{u.title}</span>
                  <span className="text-base opacity-75">{u.tagline}</span>
                </span>
                {isVoted && <CheckIcon className="mt-1 h-7 w-7 shrink-0" />}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-lg text-red-600">{error}</p>}
      <div className="mt-auto">{footer}</div>
    </div>
  );
}

// The leader's buttons for moving the story forward: the same actions as the
// shared screen's backup controls, for whatever step the game is on.
function LeaderControls({
  room,
  players,
  choices,
  secondsLeft,
  onDone,
}: {
  room: Room;
  players: Player[];
  choices: Choice[];
  secondsLeft: number | null;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    await onDone();
    setBusy(false);
  }

  const universe = currentUniverse(room);
  const act = currentAct(room);
  let note: string | null = null;
  const buttons: { label: string; onClick: () => Promise<void> }[] = [];

  if (room.phase === "lobby") {
    const { leaders } = universeVotes(players);
    if (players.length < MIN_PLAYERS) note = `Waiting for at least ${MIN_PLAYERS} players to join.`;
    else if (leaders.length === 0) note = "Waiting for votes.";
    else {
      if (leaders.length > 1) note = "It's a tie. Pick the one to play.";
      for (const u of UNIVERSES.filter((u) => leaders.includes(u.id))) {
        buttons.push({ label: `Start ${u.title}`, onClick: () => startUniverse(room, u) });
      }
    }
  } else if (room.phase === "choosing") {
    // When time runs out the shared screen picks at random and reveals by itself.
    if (secondsLeft !== 0) buttons.push({ label: "Reveal now", onClick: () => revealNow(room) });
  } else if (room.phase === "revealed" && universe && act) {
    const result = resolveAct(act, room, choices.filter((c) => c.round === room.round), players);
    if (result.status === "needs-revote") {
      buttons.push({ label: "Vote again", onClick: () => startRevote(room, result.main.tied.map((c) => c.key)) });
    } else if (result.status === "needs-pick" && result.revote) {
      note = "Still tied. Pick the winner.";
      for (const c of result.revote.tied) {
        buttons.push({ label: `${c.label} wins`, onClick: () => resolveTie(room, c.key) });
      }
    } else if (actOutcome(act, result)) {
      const isLast = room.act >= universe.acts.length;
      buttons.push({ label: isLast ? "See the ending" : "Next act", onClick: () => nextAct(room) });
    }
  } else if (room.phase === "ended" && universe) {
    buttons.push({ label: "Replay this one", onClick: () => startUniverse(room, universe, true) });
    buttons.push({ label: "Play another universe", onClick: () => backToPicker(room) });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-amber-800">You lead the game</p>
        <p className="text-base text-stone-600">Your phone moves the story forward for everyone.</p>
      </div>
      {note && <p className="text-lg font-medium text-stone-800">{note}</p>}
      {buttons.map((b, i) => (
        <button
          key={b.label}
          onClick={() => run(b.onClick)}
          disabled={busy}
          className={
            i === 0
              ? primaryButton
              : "flex h-14 w-full items-center justify-center rounded-2xl border-2 border-stone-300 bg-white text-lg font-semibold disabled:opacity-30"
          }
        >
          {b.label}
        </button>
      ))}
      {error && <p className="text-lg text-red-600">{error}</p>}
    </section>
  );
}

// Secret role (test): one random player per playthrough is the Murderer. The
// database lets only that player read the role row, so every other phone gets
// nothing back. null until known, and in the lobby.
function useIsMurderer(room: Room | null): boolean | null {
  const key = room && room.phase !== "lobby" ? `${room.id}:${room.run_start_round}` : null;
  const [role, setRole] = useState<{ key: string; murderer: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [roomId, run] = key.split(":");
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("secret_roles")
        .select("run_start_round")
        .eq("room_id", roomId)
        .eq("run_start_round", Number(run))
        .maybeSingle();
      if (!cancelled && !error) setRole({ key, murderer: data !== null });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return role && role.key === key ? role.murderer : null;
}

// Every phone shows the same card, so nobody stands out from across the room.
// The role only shows while the card is held down.
function RoleCard({ isMurderer }: { isMurderer: boolean }) {
  const [shown, setShown] = useState(false);
  const hide = () => setShown(false);

  return (
    <button
      type="button"
      onPointerDown={() => setShown(true)}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Hold to see your secret role"
      className={`flex min-h-16 w-full touch-none select-none items-center gap-4 rounded-2xl px-5 py-3 text-left [-webkit-touch-callout:none] ${
        shown && isMurderer ? "bg-red-700 text-white" : "bg-stone-900 text-white"
      }`}
    >
      {shown ? (
        isMurderer ? (
          <>
            <KnifeIcon className="h-9 w-9 shrink-0" />
            <span className="flex flex-col">
              <span className="text-xl font-semibold">You are the Murderer</span>
              <span className="text-sm opacity-80">Keep it to yourself.</span>
            </span>
          </>
        ) : (
          <span className="flex flex-col">
            <span className="text-xl font-semibold">You are innocent</span>
            <span className="text-sm opacity-80">Someone in the room is the Murderer.</span>
          </span>
        )
      ) : (
        <span className="flex flex-col">
          <span className="text-xl font-semibold">Secret role</span>
          <span className="text-sm opacity-70">Hold to see. Don&apos;t let anyone look.</span>
        </span>
      )}
    </button>
  );
}

const primaryButton =
  "flex h-16 w-full items-center justify-center rounded-2xl bg-stone-900 text-xl font-semibold text-white disabled:opacity-30";

function PhoneShell({
  roomCode,
  name,
  children,
}: {
  roomCode?: string;
  name?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-6 py-6">
      <header className="flex items-center justify-between text-base text-stone-500">
        <span className="font-semibold tracking-widest text-stone-900">{roomCode}</span>
        {name && <span>{name}</span>}
      </header>
      {children}
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="text-xl text-stone-600">{body}</p>
    </div>
  );
}
