// The model client. Sampling parameters go only to the chat family.
import OpenAI from "openai";

const client = new OpenAI();

export async function chatCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await client.chat.completions.create({ model: "chat-4", messages, temperature: 0.2, max_tokens: 400 });
  return res.choices[0]?.message?.content ?? "";
}

export async function reasoningCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await client.chat.completions.create({ model: "reasoning-5", messages });
  return res.choices[0]?.message?.content ?? "";
}
