import { NextResponse } from "next/server";
import { SCENES } from "@/lib/ai/scenes";
export const runtime = "nodejs";

// Optional cloud scene classifier. Called only after the user ticks the consent box; key stays on the server.
export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Cloud AI is not configured." }, { status: 501 });
  let image: string | undefined;
  try { ({ image } = (await req.json()) as { image?: string }); } catch { /* handled below */ }
  const prefix = "data:image/jpeg;base64,";
  if (!image || !image.startsWith(prefix) || image.length > 400_000) return NextResponse.json({ error: "Invalid image." }, { status: 400 });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? "claude-sonnet-4-6", max_tokens: 20,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.slice(prefix.length) } },
        { type: "text", text: `Classify the photo scene. Reply with exactly one word from: ${SCENES.join(", ")}.` },
      ] }],
    }),
  });
  if (!r.ok) return NextResponse.json({ error: "Provider error." }, { status: 502 });
  const j = (await r.json()) as { content?: { text?: string }[] };
  const t = String(j.content?.[0]?.text ?? "").toLowerCase();
  return NextResponse.json({ scene: SCENES.find((s) => t.includes(s)) ?? null }); // validated against allow-list
}
