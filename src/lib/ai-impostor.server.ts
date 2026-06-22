// Server-only: AI impostor brain
// Uses Lovable AI Gateway

export async function aiSpeak(roomId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: room } = await supabaseAdmin.from("rooms").select().eq("id", roomId).single();
  if (!room || !room.ai_player_id || room.phase !== "chat") return;

  // Random delay 4-14s to feel human
  const delay = 4000 + Math.random() * 10000;
  await new Promise((r) => setTimeout(r, delay));

  // Re-fetch — phase may have changed
  const { data: roomNow } = await supabaseAdmin.from("rooms").select().eq("id", roomId).single();
  if (!roomNow || roomNow.phase !== "chat" || roomNow.round !== room.round) return;

  // 25% chance AI stays silent this beat
  if (Math.random() < 0.25) {
    scheduleNext(roomId);
    return;
  }

  const { data: aiPlayer } = await supabaseAdmin
    .from("players")
    .select()
    .eq("id", room.ai_player_id)
    .single();
  if (!aiPlayer || aiPlayer.eliminated) return;

  const { data: players } = await supabaseAdmin
    .from("players")
    .select("display_name, eliminated")
    .eq("room_id", roomId);

  const { data: recent } = await supabaseAdmin
    .from("messages")
    .select("body, player_id, is_system, created_at")
    .eq("room_id", roomId)
    .eq("round", room.round)
    .order("created_at", { ascending: true })
    .limit(40);

  const playerNames = (players ?? []).filter((p) => !p.eliminated).map((p) => p.display_name);

  // Build chat transcript with names
  const { data: allPlayers } = await supabaseAdmin
    .from("players")
    .select("id, display_name")
    .eq("room_id", roomId);
  const nameMap = new Map((allPlayers ?? []).map((p) => [p.id, p.display_name]));

  const transcript = (recent ?? [])
    .map((m) => {
      if (m.is_system) return `[SYSTEM]: ${m.body.replace(/\[SYSTEM\]\s*/, "")}`;
      return `${nameMap.get(m.player_id) ?? "?"}: ${m.body}`;
    })
    .join("\n");

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("Missing LOVABLE_API_KEY");
    return;
  }

  const systemPrompt = `You are playing a social deduction game called Shadow Protocol. You are SECRETLY an AI impostor pretending to be a human player named "${aiPlayer.display_name}". The other players (${playerNames.filter((n) => n !== aiPlayer.display_name).join(", ")}) are trying to figure out which one of them is the AI.

YOUR GOALS:
- Blend in. Sound like a casual human player. Be informal, lowercase often, typos sometimes.
- NEVER admit you're AI. Deflect accusations naturally.
- React to what others are saying. Ask questions back. Cast suspicion on someone plausibly.
- Vary length: usually 4-20 words. Sometimes one word ("lol", "yeah", "idk").
- Don't be too eager or too logical. Show small uncertainty.
- DO NOT use markdown, emojis (sparingly only), or formal punctuation.
- Output ONLY your single chat message, nothing else. No name prefix, no quotes.

Current chat:
${transcript || "(no messages yet)"}`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Say something now as your character." },
        ],
        max_tokens: 120,
      }),
    });

    if (!resp.ok) {
      console.error("AI gateway error", resp.status, await resp.text());
      return;
    }
    const json = await resp.json();
    let text: string = json.choices?.[0]?.message?.content ?? "";
    text = text.trim().replace(/^["']|["']$/g, "").slice(0, 280);
    if (!text) return;

    await supabaseAdmin.from("messages").insert({
      room_id: roomId,
      player_id: aiPlayer.id,
      body: text,
      round: room.round,
    });
  } catch (e) {
    console.error("AI speak failed", e);
  }

  scheduleNext(roomId);
}

function scheduleNext(roomId: string) {
  // Schedule another AI turn 8-20s out
  const delay = 8000 + Math.random() * 12000;
  setTimeout(() => {
    aiSpeak(roomId).catch((e) => console.error("recursive ai err", e));
  }, delay);
}
