import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientId,
  getDisplayName,
  sendMessage,
  castVote,
  type Room,
  type Player,
  type Message,
  type Vote,
  MIN_PLAYERS,
  MAX_PLAYERS,
} from "@/lib/game";
import { startGame, advancePhase, pingAiTurn } from "@/lib/game.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/r/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.code} — Shadow Protocol` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const clientId = typeof window !== "undefined" ? getClientId() : "";
  const displayName = typeof window !== "undefined" ? getDisplayName() : "";

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);

  // Redirect to landing if no name set
  useEffect(() => {
    if (typeof window !== "undefined" && !displayName) {
      navigate({ to: "/" });
    }
  }, [displayName, navigate]);

  // Initial load + realtime
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: r } = await supabase
        .from("rooms")
        .select()
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (cancelled) return;
      if (!r) {
        toast.error("Room not found");
        navigate({ to: "/" });
        return;
      }
      setRoom(r as Room);
      const [{ data: ps }, { data: ms }, { data: vs }] = await Promise.all([
        supabase.from("players").select().eq("room_id", r.id).order("joined_at"),
        supabase.from("messages").select().eq("room_id", r.id).order("created_at"),
        supabase.from("votes").select().eq("room_id", r.id),
      ]);
      if (cancelled) return;
      setPlayers((ps as Player[]) ?? []);
      setMessages((ms as Message[]) ?? []);
      setVotes((vs as Vote[]) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  // Realtime subscriptions
  useEffect(() => {
    if (!room) return;
    const ch = supabase
      .channel(`room:${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.new) setRoom(payload.new as Room);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((p) => p.id !== (payload.old as Player).id);
            const next = payload.new as Player;
            const idx = prev.findIndex((p) => p.id === next.id);
            if (idx === -1) return [...prev, next].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setVotes((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((v) => v.id !== (payload.old as Vote).id);
            const next = payload.new as Vote;
            const idx = prev.findIndex((v) => v.id === next.id);
            if (idx === -1) return [...prev, next];
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [room?.id]);

  const me = useMemo(() => players.find((p) => p.client_id === clientId), [players, clientId]);
  const isHost = !!me?.is_host;

  if (loading || !room) {
    return (
      <div className="scanlines min-h-screen flex items-center justify-center">
        <div className="text-primary crt-glow flicker">{">"} ESTABLISHING UPLINK_</div>
      </div>
    );
  }

  return (
    <div className="scanlines min-h-screen flex flex-col">
      <TopBar room={room} />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 p-4 max-w-7xl w-full mx-auto">
        <MainPanel room={room} players={players} messages={messages} votes={votes} me={me} isHost={isHost} />
        <RosterPanel room={room} players={players} votes={votes} me={me} />
      </div>
    </div>
  );
}

function TopBar({ room }: { room: Room }) {
  const phaseLabel: Record<Room["phase"], string> = {
    lobby: "STAGING",
    chat: "OBSERVE",
    voting: "JUDGEMENT",
    reveal: "DISCLOSURE",
    ended: "TERMINATED",
  };
  const phaseColor: Record<Room["phase"], string> = {
    lobby: "text-amber",
    chat: "text-primary",
    voting: "text-destructive",
    reveal: "text-amber",
    ended: "text-destructive",
  };
  return (
    <header className="border-b border-border/40 px-4 py-3 flex items-center justify-between text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-terminal-dim">
          <span className="size-2 rounded-full bg-primary blink" />
          <span className="hidden sm:inline">FACILITY</span>
        </div>
        <div className="text-terminal-dim">
          ROOM <span className="text-primary font-bold tracking-[0.3em]">{room.code}</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <PhaseTimer room={room} />
        <div className={`font-bold tracking-widest ${phaseColor[room.phase]}`}>
          ◆ {phaseLabel[room.phase]} ◆
        </div>
      </div>
    </header>
  );
}

function PhaseTimer({ room }: { room: Room }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!room.phase_ends_at || room.phase === "lobby" || room.phase === "ended") return null;
  const end = new Date(room.phase_ends_at).getTime();
  const remain = Math.max(0, end - now);
  const s = Math.ceil(remain / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  const urgent = remain < 10000;
  return (
    <div className={`font-mono text-sm ${urgent ? "text-destructive alert-glow pulse-alert" : "text-foreground"}`}>
      {mm}:{ss}
    </div>
  );
}

function MainPanel({
  room,
  players,
  messages,
  votes,
  me,
  isHost,
}: {
  room: Room;
  players: Player[];
  messages: Message[];
  votes: Vote[];
  me: Player | undefined;
  isHost: boolean;
}) {
  if (room.phase === "lobby") return <Lobby room={room} players={players} isHost={isHost} />;
  return (
    <div className="grid grid-rows-[1fr_auto] gap-4 min-h-0">
      <ChatPanel room={room} players={players} messages={messages} me={me} />
      {(room.phase === "voting" || room.phase === "reveal" || room.phase === "ended") && (
        <VotingPanel room={room} players={players} votes={votes} me={me} isHost={isHost} />
      )}
      {room.phase === "chat" && isHost && (
        <HostControls room={room} />
      )}
    </div>
  );
}

function Lobby({ room, players, isHost }: { room: Room; players: Player[]; isHost: boolean }) {
  const start = useServerFn(startGame);
  const [busy, setBusy] = useState(false);
  const clientId = typeof window !== "undefined" ? getClientId() : "";

  async function handleStart() {
    setBusy(true);
    try {
      await start({ data: { roomId: room.id, clientId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start");
      setBusy(false);
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(room.code);
    toast.success("Code copied");
  }

  return (
    <div className="terminal-frame rounded-md p-8 h-full flex flex-col">
      <div className="text-xs text-terminal-dim mb-2">{">"} STAGING_AREA.log</div>
      <h2 className="font-display text-3xl text-primary crt-glow mb-1">Awaiting Operatives</h2>
      <p className="text-sm text-terminal-dim mb-8">
        Share the code below. Game begins when host triggers protocol.
      </p>

      <button
        onClick={copyCode}
        className="self-start text-left mb-8 group"
        title="Click to copy"
      >
        <div className="text-xs text-terminal-dim mb-1">ACCESS CODE</div>
        <div className="text-5xl sm:text-6xl font-bold text-primary crt-glow tracking-[0.3em] flicker group-hover:tracking-[0.4em] transition-all">
          {room.code}
        </div>
        <div className="text-xs text-terminal-dim mt-2">click to copy ↗</div>
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="text-xs text-terminal-dim mb-2">
          OPERATIVES [{players.length}/{MAX_PLAYERS}] — min {MIN_PLAYERS} to deploy
        </div>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {players.map((p) => (
            <li
              key={p.id}
              className="border border-border/60 rounded px-3 py-2 text-sm flex items-center gap-2"
            >
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="truncate">{p.display_name}</span>
              {p.is_host && <span className="text-[10px] text-amber ml-auto">HOST</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, MIN_PLAYERS - players.length) }).map((_, i) => (
            <li
              key={`empty-${i}`}
              className="border border-dashed border-border/30 rounded px-3 py-2 text-sm text-terminal-dim/40 italic"
            >
              awaiting...
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <button
          onClick={handleStart}
          disabled={busy || players.length < MIN_PLAYERS}
          className="mt-8 w-full py-4 bg-primary text-primary-foreground font-bold text-lg rounded hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all crt-glow tracking-wider"
        >
          {busy
            ? "INITIATING PROTOCOL..."
            : players.length < MIN_PLAYERS
              ? `NEED ${MIN_PLAYERS - players.length} MORE`
              : "▶ INITIATE SHADOW PROTOCOL"}
        </button>
      ) : (
        <div className="mt-8 text-center text-sm text-terminal-dim">
          {">"} Awaiting host to initiate_<span className="blink">|</span>
        </div>
      )}
    </div>
  );
}

function ChatPanel({
  room,
  players,
  messages,
  me,
}: {
  room: Room;
  players: Player[];
  messages: Message[];
  me: Player | undefined;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const nameMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const ping = useServerFn(pingAiTurn);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !me || me.eliminated || room.phase !== "chat") return;
    const text = input;
    setInput("");
    try {
      await sendMessage(room.id, me.id, text, room.round);
      // Nudge AI to keep cycling (cheap server call)
      ping({ data: { roomId: room.id } }).catch(() => {});
    } catch {
      toast.error("Send failed");
    }
  }

  const canChat = room.phase === "chat" && me && !me.eliminated;

  return (
    <div className="terminal-frame rounded-md flex flex-col min-h-[400px] lg:min-h-0">
      <div className="border-b border-border/40 px-4 py-2 text-xs text-terminal-dim flex items-center justify-between">
        <span>{">"} COMMS_CHANNEL · ROUND {room.round}</span>
        <span className="text-primary/60">{messages.filter((m) => !m.is_system).length} TRANSMISSIONS</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="text-terminal-dim text-sm italic">No transmissions yet...</div>
        )}
        {messages.map((m) => {
          if (m.is_system) {
            const isWin = m.body.includes("HUMANS WIN") || m.body.includes("AI WINS");
            return (
              <div
                key={m.id}
                className={`text-xs py-2 px-3 rounded border ${
                  isWin
                    ? "border-amber/60 bg-amber/5 text-amber alert-glow"
                    : "border-destructive/40 bg-destructive/5 text-destructive/90"
                }`}
              >
                {m.body.replace(/^\[SYSTEM\]\s*/, ">> ")}
              </div>
            );
          }
          const p = nameMap.get(m.player_id);
          const isMe = p?.client_id === me?.client_id;
          return (
            <div key={m.id} className="text-sm">
              <span className={`font-bold ${isMe ? "text-primary crt-glow" : "text-foreground"}`}>
                {p?.display_name ?? "?"}
                {p?.eliminated && <span className="text-destructive/60"> [EJECTED]</span>}
              </span>
              <span className="text-terminal-dim">: </span>
              <span className={p?.eliminated ? "text-terminal-dim line-through" : "text-foreground/90"}>{m.body}</span>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSend} className="border-t border-border/40 p-3 flex gap-2">
        <span className="text-primary self-center crt-glow">{">"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!canChat}
          placeholder={
            !me
              ? "spectating..."
              : me.eliminated
                ? "you have been ejected"
                : room.phase === "lobby"
                  ? "waiting to start..."
                  : room.phase === "voting"
                    ? "voting in progress..."
                    : room.phase === "reveal" || room.phase === "ended"
                      ? "round resolved"
                      : "transmit message..."
          }
          maxLength={280}
          className="flex-1 bg-transparent outline-none placeholder:text-terminal-dim/50 text-foreground"
        />
        <button
          type="submit"
          disabled={!canChat || !input.trim()}
          className="text-xs text-primary disabled:opacity-30 hover:bg-primary/10 px-3 py-1 rounded crt-glow"
        >
          SEND ↵
        </button>
      </form>
    </div>
  );
}

function HostControls({ room }: { room: Room }) {
  const advance = useServerFn(advancePhase);
  const clientId = typeof window !== "undefined" ? getClientId() : "";
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await advance({ data: { roomId: room.id, clientId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex justify-end">
      <button
        onClick={go}
        disabled={busy}
        className="text-xs text-amber border border-amber/40 hover:bg-amber/10 px-3 py-1.5 rounded transition-all"
      >
        {busy ? "..." : "▶ END DISCUSSION → CALL VOTE"}
      </button>
    </div>
  );
}

function VotingPanel({
  room,
  players,
  votes,
  me,
  isHost,
}: {
  room: Room;
  players: Player[];
  votes: Vote[];
  me: Player | undefined;
  isHost: boolean;
}) {
  const advance = useServerFn(advancePhase);
  const clientId = typeof window !== "undefined" ? getClientId() : "";
  const [busy, setBusy] = useState(false);
  const myVote = votes.find((v) => v.round === room.round && v.voter_id === me?.id);
  const alive = players.filter((p) => !p.eliminated);
  const tally = useMemo(() => {
    const t = new Map<string, number>();
    for (const v of votes.filter((vv) => vv.round === room.round)) {
      t.set(v.target_id, (t.get(v.target_id) ?? 0) + 1);
    }
    return t;
  }, [votes, room.round]);

  async function vote(targetId: string) {
    if (!me || me.eliminated || room.phase !== "voting") return;
    try {
      await castVote(room.id, room.round, me.id, targetId);
    } catch {
      toast.error("Vote failed");
    }
  }

  async function nextPhase() {
    setBusy(true);
    try {
      await advance({ data: { roomId: room.id, clientId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (room.phase === "ended") {
    return (
      <div className="terminal-frame rounded-md p-6 text-center">
        <div className="text-xs text-terminal-dim mb-2">{">"} TERMINATED</div>
        <div className={`text-3xl font-display font-bold ${room.winner === "humans" ? "text-primary crt-glow" : "text-destructive alert-glow"}`}>
          {room.winner === "humans" ? "▲ HUMANS PREVAIL ▲" : "▼ AI ESCAPED ▼"}
        </div>
        <div className="text-sm text-terminal-dim mt-3">
          Impostor: <span className="text-foreground font-bold">{players.find((p) => p.is_ai)?.display_name}</span>
        </div>
        <a href="/" className="inline-block mt-6 px-6 py-2 border border-primary/50 text-primary hover:bg-primary/10 rounded crt-glow text-sm">
          ← RETURN TO LOBBY
        </a>
      </div>
    );
  }

  if (room.phase === "reveal") {
    return (
      <div className="terminal-frame rounded-md p-6 text-center">
        <div className="text-amber text-sm">{">"} Next round commencing...</div>
        {isHost && (
          <button
            onClick={nextPhase}
            disabled={busy}
            className="mt-3 text-xs text-primary border border-primary/40 px-3 py-1 rounded hover:bg-primary/10"
          >
            ▶ CONTINUE
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="terminal-frame rounded-md p-4">
      <div className="text-xs text-destructive alert-glow mb-3 pulse-alert">
        {">"} EJECT VOTE — ROUND {room.round}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {alive.map((p) => {
          const count = tally.get(p.id) ?? 0;
          const isMyVote = myVote?.target_id === p.id;
          const disabled = !me || me.eliminated || p.id === me?.id;
          return (
            <button
              key={p.id}
              onClick={() => vote(p.id)}
              disabled={disabled}
              className={`p-3 rounded border text-left text-sm transition-all ${
                isMyVote
                  ? "border-destructive bg-destructive/10 alert-glow text-destructive"
                  : disabled
                    ? "border-border/30 text-terminal-dim/50 cursor-not-allowed"
                    : "border-border hover:border-destructive/60 hover:bg-destructive/5"
              }`}
            >
              <div className="font-bold truncate">{p.display_name}</div>
              <div className="text-xs mt-1 flex justify-between items-center">
                <span>{p.id === me?.id ? "[YOU]" : isMyVote ? "VOTING" : "EJECT"}</span>
                {count > 0 && <span className="text-destructive">×{count}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {isHost && (
        <button
          onClick={nextPhase}
          disabled={busy}
          className="mt-3 w-full text-xs text-amber border border-amber/40 hover:bg-amber/10 px-3 py-2 rounded"
        >
          ▶ RESOLVE VOTE NOW
        </button>
      )}
    </div>
  );
}

function RosterPanel({
  room,
  players,
  votes,
  me,
}: {
  room: Room;
  players: Player[];
  votes: Vote[];
  me: Player | undefined;
}) {
  const voteCount = votes.filter((v) => v.round === room.round).length;
  return (
    <aside className="terminal-frame rounded-md p-4 flex flex-col gap-4 max-h-[80vh] overflow-hidden">
      <div>
        <div className="text-xs text-terminal-dim mb-2">{">"} ROSTER</div>
        <ul className="space-y-1.5 overflow-y-auto">
          {players.map((p) => (
            <li
              key={p.id}
              className={`text-sm flex items-center gap-2 px-2 py-1.5 rounded ${
                p.eliminated ? "opacity-40 line-through" : ""
              } ${p.client_id === me?.client_id ? "bg-primary/10" : ""}`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  p.eliminated ? "bg-destructive" : "bg-primary"
                }`}
              />
              <span className="truncate flex-1">{p.display_name}</span>
              {p.is_host && <span className="text-[9px] text-amber">HOST</span>}
              {p.client_id === me?.client_id && <span className="text-[9px] text-primary">YOU</span>}
            </li>
          ))}
        </ul>
      </div>

      {room.phase === "voting" && (
        <div className="border-t border-border/40 pt-3">
          <div className="text-xs text-terminal-dim mb-1">VOTES CAST</div>
          <div className="text-2xl text-destructive alert-glow font-bold">
            {voteCount} / {players.filter((p) => !p.eliminated).length}
          </div>
        </div>
      )}

      {me?.eliminated && (
        <div className="border-t border-border/40 pt-3 text-xs text-destructive alert-glow">
          {">"} YOU HAVE BEEN EJECTED
          <br />
          <span className="text-terminal-dim">Observe in silence.</span>
        </div>
      )}

      <div className="mt-auto text-[10px] text-terminal-dim/70">
        round {room.round} · {players.length} operatives
      </div>
    </aside>
  );
}
