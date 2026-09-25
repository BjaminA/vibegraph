// A hosted-model client: the boundary this project pays for per call, with
// cost and non-determinism the IR cannot see. Before M-CMD.2 the taxonomy
// had no role a package like this could honestly carry, so `openai` read
// as "unclassified" and this file could not be a funnel.
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** One summary, one round trip to the model service. */
export async function summarize(text: string): Promise<string> {
  const res = await client.responses.create({ model: "gpt-4.1-mini", input: text });
  return res.output_text;
}
