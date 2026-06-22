// Server functions that orchestrate the game (admin RLS-bypass)
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const StartGameInput = z.object({ roomId: z.string().uuid(), clientId: z.string() });

export const startGame = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StartGameInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room, error } = await supabaseAdmin
      .from("rooms")
      .select()
      .eq("id", data.roomId)
      .single();
    if (error) throw error;
    if (room.host_id !== data.clientId) throw new Error("Only host can start");
    if (room.phase !== "lobby") throw new Error("Already started");

    const { data: players } = await supabaseAdmin
      .from("players")
      .select()
      .eq("room_id", data.roomId);
    if (!players || players.length < 4) throw new Error("Need at least 4 players");

    // Pick AI impostor secretly
    const aiPlayer = players[Math.floor(Math.random() * players.length)];
    await supabaseAdmin
      .from("players")
      .update({ is_ai: true })
      .eq("id", aiPlayer.id);

    const endsAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("rooms")
      .update({
        phase: "chat",
        round: 1,
        ai_player_id: aiPlayer.id,
        phase_ends_at: endsAt,
      })
      .eq("id", data.roomId);

    await supabaseAdmin.from("messages").insert({
      room_id: data.roomId,
      player_id: aiPlayer.id, // any player id; flagged as system
      body: "[SYSTEM] Shadow Protocol initiated. One of you has been replaced. Identify the impostor.",
      round: 1,
      is_system: true,
    });

    // Trigger first AI turn (fire and forget)
    triggerAiTurn(data.roomId).catch((e) => console.error("ai turn err", e));

    return { ok: true };
  });

const AdvanceInput = z.object({ roomId: z.string().uuid(), clientId: z.string() });

export const advancePhase = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AdvanceInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select()
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Not found");
    if (room.host_id !== data.clientId) throw new Error("Host only");

    if (room.phase === "chat") {
      const endsAt = new Date(Date.now() + 60 * 1000).toISOString();
      await supabaseAdmin
        .from("rooms")
        .update({ phase: "voting", phase_ends_at: endsAt })
        .eq("id", data.roomId);
      // AI casts a vote
      castAiVote(data.roomId, room.round).catch((e) => console.error("ai vote err", e));
    } else if (room.phase === "voting") {
      await resolveVoting(data.roomId, room.round);
    } else if (room.phase === "reveal") {
      await startNextRound(data.roomId);
    }
    return { ok: true };
  });

async function resolveVoting(roomId: string, round: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: votes } = await supabaseAdmin
    .from("votes")
    .select()
    .eq("room_id", roomId)
    .eq("round", round);
  const { data: players } = await supabaseAdmin
    .from("players")
    .select()
    .eq("room_id", roomId)
    .eq("eliminated", false);
  if (!players) return;

  // Tally
  const tally = new Map<string, number>();
  for (const v of votes ?? []) {
    tally.set(v.target_id, (tally.get(v.target_id) ?? 0) + 1);
  }
  let maxVotes = 0;
  let ejected: string | null = null;
  let tie = false;
  for (const [id, n] of tally) {
    if (n > maxVotes) {
      maxVotes = n;
      ejected = id;
      tie = false;
    } else if (n === maxVotes) {
      tie = true;
    }
  }

  let systemMsg = "";
  const { data: room } = await supabaseAdmin.from("rooms").select().eq("id", roomId).single();
  if (!room) return;

  let winner: string | null = null;
  if (tie || !ejected) {
    systemMsg = "[SYSTEM] Vote tied. No one ejected. The impostor remains.";
  } else {
    const target = players.find((p) => p.id === ejected);
    await supabaseAdmin.from("players").update({ eliminated: true }).eq("id", ejected);
    if (target?.is_ai) {
      systemMsg = `[SYSTEM] ${target.display_name} ejected. >> IDENTITY: ARTIFICIAL <<  HUMANS WIN.`;
      winner = "humans";
    } else {
      systemMsg = `[SYSTEM] ${target?.display_name} ejected. >> IDENTITY: HUMAN <<  An innocent was lost.`;
    }
  }

  // Check AI survival win condition
  const remaining = players.filter((p) => p.id !== ejected);
  const aiAlive = remaining.find((p) => p.is_ai);
  if (!winner && aiAlive && remaining.length <= 3) {
    systemMsg += "  >> AI WINS — too few humans remain. <<";
    winner = "ai";
  }

  await supabaseAdmin.from("messages").insert({
    room_id: roomId,
    player_id: room.ai_player_id ?? players[0].id,
    body: systemMsg,
    round,
    is_system: true,
  });

  const endsAt = new Date(Date.now() + 8000).toISOString();
  await supabaseAdmin
    .from("rooms")
    .update({
      phase: winner ? "ended" : "reveal",
      phase_ends_at: endsAt,
      winner,
    })
    .eq("id", roomId);
}

async function startNextRound(roomId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: room } = await supabaseAdmin.from("rooms").select().eq("id", roomId).single();
  if (!room) return;
  const nextRound = room.round + 1;
  const endsAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("rooms")
    .update({ phase: "chat", round: nextRound, phase_ends_at: endsAt })
    .eq("id", roomId);
  await supabaseAdmin.from("messages").insert({
    room_id: roomId,
    player_id: room.ai_player_id!,
    body: `[SYSTEM] Round ${nextRound}. Continue investigation.`,
    round: nextRound,
    is_system: true,
  });
  triggerAiTurn(roomId).catch(() => {});
}

async function triggerAiTurn(roomId: string) {
  // Call our edge function — but since this IS server-side, just inline it
  const { aiSpeak } = await import("./ai-impostor.server");
  await aiSpeak(roomId);
}

async function castAiVote(roomId: string, round: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: room } = await supabaseAdmin.from("rooms").select().eq("id", roomId).single();
  if (!room?.ai_player_id) return;
  const { data: players } = await supabaseAdmin
    .from("players")
    .select()
    .eq("room_id", roomId)
    .eq("eliminated", false);
  if (!players) return;
  const targets = players.filter((p) => p.id !== room.ai_player_id);
  if (!targets.length) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  await supabaseAdmin.from("votes").upsert(
    { room_id: roomId, round, voter_id: room.ai_player_id, target_id: target.id },
    { onConflict: "room_id,round,voter_id" },
  );
}

const PingInput = z.object({ roomId: z.string().uuid() });
export const pingAiTurn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PingInput.parse(d))
  .handler(async ({ data }) => {
    triggerAiTurn(data.roomId).catch((e) => console.error("ping ai err", e));
    return { ok: true };
  });
