// Shared game library — client-safe
import { supabase } from "@/integrations/supabase/client";

export type Phase = "lobby" | "chat" | "voting" | "reveal" | "ended";

export type Room = {
  id: string;
  code: string;
  host_id: string;
  phase: Phase;
  round: number;
  ai_player_id: string | null;
  phase_ends_at: string | null;
  winner: string | null;
  created_at: string;
};

export type Player = {
  id: string;
  room_id: string;
  client_id: string;
  display_name: string;
  is_host: boolean;
  is_ai: boolean;
  eliminated: boolean;
  joined_at: string;
};

export type Message = {
  id: string;
  room_id: string;
  player_id: string;
  body: string;
  round: number;
  is_system: boolean;
  created_at: string;
};

export type Vote = {
  id: string;
  room_id: string;
  round: number;
  voter_id: string;
  target_id: string;
  created_at: string;
};

export const CHAT_DURATION_MS = 4 * 60 * 1000;
export const VOTE_DURATION_MS = 60 * 1000;
export const REVEAL_DURATION_MS = 8 * 1000;
export const MIN_PLAYERS = 4; // relaxed from 8 so a small group can test
export const MAX_PLAYERS = 12;

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("sp_client_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("sp_client_id", id);
  }
  return id;
}

export function getDisplayName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("sp_display_name") ?? "";
}

export function setDisplayName(name: string) {
  localStorage.setItem("sp_display_name", name);
}

export function genRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function createRoom(displayName: string) {
  const clientId = getClientId();
  const code = genRoomCode();
  const { data: room, error } = await supabase
    .from("rooms")
    .insert({ code, host_id: clientId })
    .select()
    .single();
  if (error) throw error;
  const { error: pe } = await supabase
    .from("players")
    .insert({
      room_id: room.id,
      client_id: clientId,
      display_name: displayName,
      is_host: true,
    });
  if (pe) throw pe;
  return room as Room;
}

export async function joinRoom(code: string, displayName: string) {
  const clientId = getClientId();
  const { data: room, error } = await supabase
    .from("rooms")
    .select()
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  if (!room) throw new Error("Room not found");

  // Upsert player (rejoin support)
  const { data: existing } = await supabase
    .from("players")
    .select()
    .eq("room_id", room.id)
    .eq("client_id", clientId)
    .maybeSingle();

  if (!existing) {
    if (room.phase !== "lobby") throw new Error("Game already in progress");
    const { count } = await supabase
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id);
    if ((count ?? 0) >= MAX_PLAYERS) throw new Error("Room is full");
    const { error: pe } = await supabase.from("players").insert({
      room_id: room.id,
      client_id: clientId,
      display_name: displayName,
    });
    if (pe) throw pe;
  } else if (existing.display_name !== displayName) {
    await supabase.from("players").update({ display_name: displayName }).eq("id", existing.id);
  }
  return room as Room;
}

export async function sendMessage(roomId: string, playerId: string, body: string, round: number) {
  const trimmed = body.trim().slice(0, 280);
  if (!trimmed) return;
  await supabase.from("messages").insert({
    room_id: roomId,
    player_id: playerId,
    body: trimmed,
    round,
  });
}

export async function castVote(roomId: string, round: number, voterId: string, targetId: string) {
  await supabase
    .from("votes")
    .upsert(
      { room_id: roomId, round, voter_id: voterId, target_id: targetId },
      { onConflict: "room_id,round,voter_id" },
    );
}
