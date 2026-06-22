
# Shadow Protocol — Build Plan

A real-time social deduction game where 8–12 players are trapped in a facility. One player is secretly replaced by an AI that mimics human behavior. Survivors must identify the impostor through chat and voting.

## Scope of v1

To ship a polished, playable v1, I'll focus on the core loop and defer cosmetic extras. Realtime sync uses Lovable Cloud (Supabase Realtime) — no separate WebSocket server needed, which keeps the stack simple and deployable.

## Core Game Loop

```text
LOBBY  →  ROUND START  →  CHAT PHASE  →  VOTING  →  REVEAL  →  NEXT ROUND / END
 (room    (roles &       (timed open    (anon     (eject &   
  code)    AI assigned)   chat)          ballot)   verdict)  
```

- Host creates a room → gets a 6-char code
- 8–12 players join with a display name
- Host starts → server secretly picks one slot to be replaced by AI
- Chat phase (e.g. 4 min): everyone chats freely; AI participates via LLM
- Voting phase (60s): anonymous vote on who to eject
- Reveal: ejected player's identity shown
- Humans win if AI ejected; AI wins if it survives to final 3

## Screens

1. **Landing** — game pitch, "Create Room" / "Join Room"
2. **Lobby** — room code, player list, host controls, ready states
3. **Game Room** — chat transcript, player roster with status, phase timer, voting panel
4. **Round Reveal / Endgame** — animated identity reveal, win condition, "Play again"

## Visual Direction: Dark Facility / Sci-fi Thriller

- Palette: deep charcoal background, sickly green CRT accent, blood-red alerts, off-white text
- Typography: monospace (JetBrains Mono) for chat/UI chrome, geometric sans for headings
- Texture: faint scanline overlay, subtle CRT glow on accents, terminal-style prompts
- Motion: typewriter chat entry, glitch/flicker on phase transitions, pulse on timer < 10s

## AI Impostor

- Server edge function calls Lovable AI (Gemini Flash) on each AI turn
- System prompt: "You are a human player in a social deduction game. Sound casual, sometimes uncertain. Never admit you're AI. Match the tone of recent messages."
- Context: rolling window of recent chat + player names + your assigned name
- Pacing: AI waits a realistic delay (3–12s) before posting; sometimes stays silent a round
- During voting: AI casts a vote against a plausible suspect (not itself)

## Data Model (Lovable Cloud / Postgres)

```text
rooms        (id, code, host_id, phase, round, ai_player_id, started_at)
players      (id, room_id, display_name, is_host, is_ai, eliminated, joined_at)
messages     (id, room_id, player_id, body, round, created_at)
votes        (id, room_id, round, voter_id, target_id, created_at)
```

- RLS: players can read rows for rooms they're in; only host can mutate room phase; votes hidden until reveal
- Realtime channels: `room:{id}:messages`, `room:{id}:state`, `room:{id}:votes`

## Server Logic (TanStack server functions + one edge function for LLM)

- `createRoom`, `joinRoom`, `startGame`, `sendMessage`, `castVote`, `advancePhase`
- `aiTurn` edge function: assembles context, calls Lovable AI, posts message as the AI player
- Phase timer driven by `setTimeout` on the host client + server-validated `advancePhase`

## Identity

Anonymous sessions stored in localStorage (no signup) — players get a `player_id` on first visit, scoped per room.

## Out of Scope for v1 (can add later)

- Accounts, persistent stats, leaderboards
- Spectator mode, replays
- Multiple AI impostors, special roles (medic, detective)
- Voice chat
- Matchmaking — v1 is room-code only

## Technical Notes

- Stack: TanStack Start (already set up), Lovable Cloud (Postgres + Realtime + Edge Functions), Lovable AI Gateway (`google/gemini-3-flash-preview`)
- Realtime via Supabase Realtime subscriptions, not a custom WebSocket server — same UX, zero infra
- One edge function: `ai-turn` (server-side LLM call, keeps API key private)
- All game state authoritative in DB; clients render from subscriptions

## Build Order

1. Enable Lovable Cloud + schema + RLS
2. Design system (dark facility tokens, scanlines, mono type)
3. Landing + Create/Join room flow
4. Lobby with realtime player list
5. Chat room with realtime messages + phase timer
6. AI impostor edge function + auto-posting
7. Voting + reveal + endgame
8. Polish: animations, sound cues, mobile layout

Ready to start with step 1?
