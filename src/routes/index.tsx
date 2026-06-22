import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createRoom, joinRoom, getDisplayName, setDisplayName } from "@/lib/game";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shadow Protocol — Find the AI Before It Finds You" },
      { name: "description", content: "Real-time social deduction. 4-12 players. One impostor. AI-powered." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState(typeof window !== "undefined" ? getDisplayName() : "");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"menu" | "create" | "join">("menu");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      setDisplayName(name.trim());
      const room = await createRoom(name.trim());
      navigate({ to: "/r/$code", params: { code: room.code } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create room");
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    try {
      setDisplayName(name.trim());
      const room = await joinRoom(code.trim().toUpperCase(), name.trim());
      navigate({ to: "/r/$code", params: { code: room.code } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join");
      setBusy(false);
    }
  }

  return (
    <div className="scanlines min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/40 px-6 py-3 flex items-center justify-between text-xs text-terminal-dim">
        <div className="flex items-center gap-3">
          <span className="size-2 rounded-full bg-primary blink" />
          <span>FACILITY UPLINK · ACTIVE</span>
        </div>
        <div className="hidden sm:flex gap-6">
          <span>SECTOR 7</span>
          <span>{new Date().toISOString().slice(0, 10)}</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl">
          {/* Hero */}
          <div className="mb-10 text-center">
            <div className="text-xs text-destructive alert-glow mb-4 flicker tracking-[0.3em]">
              ▲ CLASSIFIED ▲
            </div>
            <h1 className="font-display text-5xl sm:text-7xl font-bold text-primary crt-glow leading-none">
              SHADOW
              <br />
              PROTOCOL
            </h1>
            <p className="mt-6 text-foreground/80 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
              You and your team are sealed inside the facility. One of you has been{" "}
              <span className="text-destructive alert-glow">silently replaced</span> by an AI.
              <br />
              It speaks like you. It lies like you. Find it before it finds the exit.
            </p>
          </div>

          {/* Action card */}
          <div className="terminal-frame rounded-md p-6 sm:p-8 relative">
            {/* Top label */}
            <div className="absolute -top-3 left-6 bg-background px-2 text-xs text-primary/80 font-mono">
              {">"} ACCESS_TERMINAL.exe
            </div>

            {mode === "menu" && (
              <div className="space-y-4">
                <p className="text-sm text-terminal-dim mb-6">
                  {">"} Awaiting operator input_<span className="blink">|</span>
                </p>
                <button
                  onClick={() => setMode("create")}
                  className="w-full group p-4 rounded border border-primary/30 hover:border-primary hover:bg-primary/5 transition-all text-left"
                >
                  <div className="text-primary crt-glow font-bold flex items-center justify-between">
                    <span>[01] OPEN NEW FACILITY</span>
                    <span className="opacity-0 group-hover:opacity-100">→</span>
                  </div>
                  <div className="text-xs text-terminal-dim mt-1">
                    Create a room. You become host. Share the code.
                  </div>
                </button>
                <button
                  onClick={() => setMode("join")}
                  className="w-full group p-4 rounded border border-border hover:border-primary hover:bg-primary/5 transition-all text-left"
                >
                  <div className="text-foreground font-bold flex items-center justify-between">
                    <span>[02] INFILTRATE EXISTING</span>
                    <span className="opacity-0 group-hover:opacity-100">→</span>
                  </div>
                  <div className="text-xs text-terminal-dim mt-1">
                    Enter a 6-character access code.
                  </div>
                </button>
              </div>
            )}

            {mode === "create" && (
              <form onSubmit={handleCreate} className="space-y-4">
                <Field label="OPERATOR CALLSIGN">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={20}
                    required
                    placeholder="enter your name"
                    className="w-full bg-input/60 border border-primary/30 focus:border-primary outline-none rounded px-3 py-2 font-mono text-foreground placeholder:text-terminal-dim/60"
                  />
                </Field>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setMode("menu")}
                    className="px-4 py-2 text-sm text-terminal-dim hover:text-foreground transition-colors"
                  >
                    ← BACK
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !name.trim()}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground font-bold rounded hover:bg-primary/90 disabled:opacity-40 transition-all crt-glow"
                  >
                    {busy ? "INITIALIZING..." : "OPEN FACILITY →"}
                  </button>
                </div>
              </form>
            )}

            {mode === "join" && (
              <form onSubmit={handleJoin} className="space-y-4">
                <Field label="OPERATOR CALLSIGN">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={20}
                    required
                    placeholder="enter your name"
                    className="w-full bg-input/60 border border-primary/30 focus:border-primary outline-none rounded px-3 py-2 font-mono text-foreground placeholder:text-terminal-dim/60"
                  />
                </Field>
                <Field label="ACCESS CODE">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                    required
                    placeholder="6-char code"
                    className="w-full bg-input/60 border border-primary/30 focus:border-primary outline-none rounded px-3 py-2 font-mono text-primary crt-glow tracking-[0.4em] text-center text-xl uppercase"
                  />
                </Field>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setMode("menu")}
                    className="px-4 py-2 text-sm text-terminal-dim hover:text-foreground transition-colors"
                  >
                    ← BACK
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !name.trim() || code.length < 4}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground font-bold rounded hover:bg-primary/90 disabled:opacity-40 transition-all crt-glow"
                  >
                    {busy ? "BREACHING..." : "INFILTRATE →"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Specs */}
          <div className="mt-8 grid grid-cols-3 gap-4 text-center text-xs text-terminal-dim">
            <Spec label="PLAYERS" value="4–12" />
            <Spec label="IMPOSTORS" value="01" />
            <Spec label="MODE" value="REAL-TIME" />
          </div>
        </div>
      </main>

      <footer className="border-t border-border/40 px-6 py-3 text-xs text-terminal-dim flex justify-between">
        <span>// shadow_protocol_v1.0</span>
        <span className="hidden sm:inline">[TRUST NO ONE]</span>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-primary/70 mb-1.5 tracking-wider">{">"} {label}</div>
      {children}
    </label>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/60 rounded p-3">
      <div className="text-primary crt-glow font-bold text-base">{value}</div>
      <div className="text-[10px] tracking-widest mt-1">{label}</div>
    </div>
  );
}
