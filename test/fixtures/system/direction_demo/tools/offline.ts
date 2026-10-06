#!/usr/bin/env node
// Replays the release rule offline, against an in-memory store.
import { release } from "../lib/logic";

const docs = new Map<string, unknown>();
const memory = {
  async write(zone: string, id: string, doc: unknown): Promise<void> { docs.set(`${zone}/${id}`, doc); },
  async read(zone: string, id: string): Promise<unknown> { return docs.get(`${zone}/${id}`); },
};

async function main(): Promise<void> {
  await release(memory, process.argv[2] ?? "o1");
}

main();
