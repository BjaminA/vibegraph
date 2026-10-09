// The decider's feed: it watches every inbox the registry found, and reads each
// one at start-up. The names come in as an array built at run time.
import type { Registry } from "./registry.ts";

export function inboxFeed(registry: Registry, inboxes: string[]) {
  return {
    watchAll: async (on: (id: string) => void) => {
      const stops = await Promise.all(inboxes.map(async (b) => (await registry.meta(b)).watch("__meta", "idx", on)));
      return () => stops.forEach((s) => s());
    },
    readAll: async () => {
      for (const inbox of inboxes) await (await registry.meta(inbox)).read("__meta");
    },
  };
}
