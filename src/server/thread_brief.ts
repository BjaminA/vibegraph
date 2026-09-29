// The thread BRIEF (2026-09-29, from the codegraph comparison): one call that
// answers "what does this thread do and what does its code say" — the
// contract, then the verbatim source of its functions, RANKED.
//
// codegraph measured the win of one answer over many tool calls, and named
// its own cost: ~80% more resident context. That is why the source here is
// ranked (src/shared/thread_rank.ts, the same ranking the thread view draws):
// PRIMARY functions first (the seed and the steps on the path to what leaves
// the project), then SECONDARY step functions (the project's own helpers) if
// the budget allows, never TERTIARY ones (local data work, logging, pure
// helpers). Each function once, in walk order. Whatever does not fit is named
// with how to fetch it.
//
// Pure: the caller hands in the thread, the project IR, the stack and
// crossing indexes, the rendered contract and a way to read a source file.

import { rankThread, type RankThread } from "../shared/thread_rank.ts";
import { threadFacts } from "../shared/thread_rank_facts.ts";

export interface BriefInput {
  thread: RankThread & { entryPointId?: string | null; seed: { file: string; irNodeId?: string; qualifiedName: string } };
  files: Record<string, { nodes?: ReadonlyArray<{ id?: string; type?: string; line?: number; endLine?: number; decoratorLine?: number; name?: string }> }>;
  stack: Record<string, unknown> | null;
  crossings: { byThread?: Record<string, ReadonlyArray<{ nodeId?: string | null }>>; all?: ReadonlyArray<{ nodeId?: string | null }> } | null;
  contractText: string;
  readSource: (relFile: string) => string | null;
  maxChars?: number;
}

export interface Brief {
  text: string;
  included: string[];
  omitted: string[];
  primaryNodes: number;
  totalNodes: number;
}

const FUNCTION_LINES_CAP = 120;

type Fn = { file: string; id: string; label: string };

function functionsAt(thread: BriefInput["thread"], rankOf: (id: string) => number | undefined, rank: number, seen: Set<string>): Fn[] {
  const out: Fn[] = [];
  for (const n of thread.nodes) {
    if (rankOf(n.id) !== rank) continue;
    if ((n.kind !== "seed" && n.kind !== "step") || !n.file || !n.irNodeId) continue;
    const key = `${n.file}|${n.irNodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: n.file, id: n.irNodeId, label: n.label });
  }
  return out;
}

export function buildThreadBrief(input: BriefInput): Brief {
  const { thread, files, contractText } = input;
  const maxChars = input.maxChars ?? 16000;
  const ranked = rankThread(thread, threadFacts(thread as never, files as never, input.stack as never, input.crossings as never));
  const rankOf = (id: string) => ranked.rank.get(id);
  const primaryNodes = thread.nodes.filter((n) => rankOf(n.id) === 1).length;
  const seen = new Set<string>();
  const primary = functionsAt(thread, rankOf, 1, seen);
  const secondary = functionsAt(thread, rankOf, 2, seen);
  const parts = [
    `# Thread brief: ${thread.seed.qualifiedName}`,
    `IR fact, derived by VibeGraph (no model). The contract, then verbatim source ranked as the thread view ranks it: PRIMARY functions (the seed and the steps on the path to what leaves the project; ${primaryNodes} of ${thread.nodes.length} nodes rank primary), then SECONDARY step functions (the project's own helpers) while the budget lasts. Tertiary code (local data work, logging, pure helpers) is never shown.`,
    "",
    contractText,
  ];
  let used = parts.join("\n").length;
  const included: string[] = [];
  const omitted: string[] = [];
  const sourceCache = new Map<string, string[] | null>();
  const emit = (list: Fn[], heading: string) => {
    if (!list.length) return;
    const head = `\n## ${heading}`;
    let headed = false;
    for (const f of list) {
      const node = (files[f.file]?.nodes ?? []).find((x) => x.id === f.id);
      if (!node || typeof node.line !== "number") { omitted.push(`${f.file}:${f.id} (no line span in the IR)`); continue; }
      if (!sourceCache.has(f.file)) sourceCache.set(f.file, input.readSource(f.file)?.split("\n") ?? null);
      const lines = sourceCache.get(f.file);
      if (!lines) { omitted.push(`${f.file}:${f.id} (source unreadable)`); continue; }
      const start = (node.decoratorLine ?? node.line) - 1;
      const end = Math.min(typeof node.endLine === "number" ? node.endLine : node.line, lines.length);
      let body = lines.slice(start, end);
      let note = "";
      if (body.length > FUNCTION_LINES_CAP) {
        note = `\n… (${body.length - FUNCTION_LINES_CAP} more lines of this function; vibegraph_get_node_source has it whole)`;
        body = body.slice(0, FUNCTION_LINES_CAP);
      }
      const block = `\n### ${f.label} — ${f.file}:${start + 1}-${end} \`${f.id}\`\n\`\`\`\n${body.join("\n")}\n\`\`\`${note}`;
      const cost = block.length + (headed ? 0 : head.length);
      if (used + cost > maxChars) { omitted.push(`${f.file}:${f.id}`); continue; }
      if (!headed) { parts.push(head); headed = true; }
      parts.push(block);
      used += cost;
      included.push(`${f.file}:${f.id}`);
    }
  };
  emit(primary, "Primary functions, verbatim");
  emit(secondary, "Secondary functions (the project's own helpers on this thread), verbatim");
  if (!primary.length && !secondary.length) parts.push("", "(No step on this thread has a body in this project — it leaves the project at its seed.)");
  if (omitted.length) {
    parts.push("", `Not included (over the ${maxChars}-character budget or unreadable): ${omitted.join(", ")} — fetch one with vibegraph_get_node_source.`);
  }
  return { text: parts.join("\n"), included, omitted, primaryNodes, totalNodes: thread.nodes.length };
}
