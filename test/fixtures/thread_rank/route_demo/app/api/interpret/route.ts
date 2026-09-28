import OpenAI from "openai";
import { rateLimit } from "../../../lib/ratelimit";

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("interpret: no key");
    return Response.json({ error: "not configured" }, { status: 500 });
  }
  if (rateLimit(req.headers.get("x-forwarded-for") ?? "")) {
    return Response.json({ error: "slow down" }, { status: 429 });
  }
  const body = await req.json();
  const words = String(body.text ?? "").split(" ").map((w) => w.trim()).filter(Boolean);
  console.log("interpret: words", words.length);
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: words.join(" ") }],
  });
  return Response.json({ text: completion.choices[0]?.message?.content ?? "" });
}
