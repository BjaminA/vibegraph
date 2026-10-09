// "EXPLAIN THIS GAP" — rung 3 as one model call (2026-10-08). The one part of
// the run-time ladder that spends tokens, and only on a person's button or
// command, after an estimate; never from a hook. For ONE facts gap the model is
// shown the plan step that asserts it and the call sites in the code the box's
// threads reach (each line numbered), and returns one claim with the chain of
// lines it rests on. Every link must cite a line it was shown; the claim then
// goes through `claim propose`'s own checks and is stored PROPOSED · inferred —
// a person decides, or a later derived / observed operation confirms it.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { BriefFacts } from "./brief_facts.ts";
import type { BoxOp } from "./brief_data.ts";
import { openGaps } from "./brief_data.ts";
import { extractJson } from "./brief_validate.ts";
import { modelSource } from "./model_source.ts";
import { effectOf } from "../shared/sdk_verbs.ts";
import { CLAIM_VERBS } from "../shared/brief_types.ts";

const MAX_LINES = 80;
const VERB = { watch: "watches", read: "reads", write: "writes", attempt: "writes" } as const;

export interface GapDossier { gap: BoxOp; text: string; shown: Set<string>; estimate: number }

/** The open facts gaps, numbered as `claim gaps` and the review sheet list them. */
export const gapList = (facts: BriefFacts): BoxOp[] => openGaps(facts.data);

export function gapDossier(model: ArchModelRecord, facts: BriefFacts, gap: BoxOp, readLines: (f: string) => string[] | null): GapDossier {
  const node = model.nodes.find((n) => n.id === gap.box);
  const src = modelSource(model);
  const eps = new Set([...(node?.threads ?? []), ...(node?.entryPoints ?? [])]);
  const reached = new Set<string>([...eps].map((e) => e.split(":")[0]));
  for (const t of src?.threads ?? []) if (t.entryPointId && eps.has(t.entryPointId)) for (const f of t.filesReached ?? []) reached.add(f);
  const shown = new Set<string>();
  const L: string[] = [];
  const zone = facts.data.zones.get(gap.zone);
  L.push(`THE GAP: ${facts.labels.get(gap.box) ?? gap.box} (${gap.box}) ${VERB[gap.op]} ${gap.zone} — ${gap.cite} declares it; the code VibeGraph reads statically shows no such call.`);
  if (zone) L.push(`THE ZONE: ${zone.id} holds ${zone.holds.join(", ")}${zone.holes.length ? `; one per ${zone.holes.join(" and ")}` : ""}.`);
  L.push("", "THE CODE this process reaches — call sites that read, write or watch something, and the functions around them (cite as file:line):");
  let count = 0;
  for (const file of [...reached].sort()) {
    const lines = readLines(file);
    const nodes = src?.files[file]?.nodes ?? [];
    if (!lines) continue;
    const want = new Set<number>();
    for (const n of nodes) {
      const callee = String(n?.funcName ?? n?.callTarget ?? "");
      const method = callee.split(".").pop() ?? "";
      // a call whose verb reads, writes or watches — a method, or a project
      // function named for it (`readDoc`, `watchAll`) — and the line before
      if (callee && effectOf(method) && typeof n.line === "number") { want.add(n.line); want.add(n.line - 1); }
      if (n?.type === "function_def" && typeof n.line === "number" && nodes.some((x: any) => x?.parentId === n.id && /\.(watch|read|write|get|set|put|subscribe|on)\b/.test(String(x?.funcName ?? "")))) want.add(n.line);
    }
    const picked = [...want].filter((l) => l >= 1 && l <= lines.length).sort((a, b) => a - b);
    if (!picked.length) continue;
    L.push(`--- ${file}`);
    for (const l of picked) {
      if (count >= MAX_LINES) break;
      L.push(`${file}:${l}: ${lines[l - 1].trim().slice(0, 200)}`);
      shown.add(`${file}:${l}`);
      count++;
    }
    if (count >= MAX_LINES) { L.push(`(more call sites past the first ${MAX_LINES} lines are not shown)`); break; }
  }
  const text = L.join("\n");
  return { gap, text, shown, estimate: Math.ceil((text.length + 1600) / 4) };
}

export function gapPrompt(d: GapDossier): string {
  return [
    "You are closing ONE facts gap on a code map: the project says a process reaches a zone of its data store, and VibeGraph cannot see the call in the code statically (the names are often decided at run time).",
    "From the code below ONLY, say whether and how this process does it — as ONE claim and the CHAIN of lines that shows it (where the names come from, how they reach the call, the call itself).",
    "RULES: every chain link cites a file:line listed below; a link that cites anything else is refused. If the code shown does not show it, answer {\"none\": \"why\"} — never guess.",
    `verbs: ${CLAIM_VERBS.join(", ")}. The object is the zone id or the family name.`,
    "",
    d.text,
    "",
    "Answer with ONE JSON object and nothing else:",
    `{ "claim": { "subject": "${d.gap.box}", "verb": "${VERB[d.gap.op]}", "object": "${d.gap.zone}" }, "chain": [ { "cite": "file:line", "says": "what this line does" } ] }`,
    "or { \"none\": \"why the code shown does not show it\" }",
  ].join("\n");
}

/** The reply, checked: the claim's shape, and every chain link a line it was shown. */
export function parseGapReply(text: string, d: GapDossier): { ok: true; claim: { subject: string; verb: string; object: string; partition?: string[]; not?: boolean }; cites: string[]; why: string } | { ok: false; reason: string } {
  const raw = extractJson(text) as any;
  if (!raw || typeof raw !== "object") return { ok: false, reason: "the reply holds no JSON object" };
  if (typeof raw.none === "string") return { ok: false, reason: `the model found no support in the code shown: ${raw.none.slice(0, 300)}` };
  const c = raw.claim;
  if (!c || typeof c.subject !== "string" || typeof c.verb !== "string" || typeof c.object !== "string") return { ok: false, reason: "the reply has no claim {subject, verb, object}" };
  const chain = Array.isArray(raw.chain) ? raw.chain.filter((x: any) => typeof x?.cite === "string") : [];
  const bad = chain.filter((x: any) => !d.shown.has(x.cite.trim())).map((x: any) => x.cite);
  if (bad.length) return { ok: false, reason: `the chain cites lines it was not shown: ${bad.slice(0, 4).join(", ")}` };
  if (!chain.length) return { ok: false, reason: "the claim has no chain of lines" };
  const why = chain.map((x: any) => `${x.cite} ${String(x.says ?? "").slice(0, 120)}`).join("; ");
  return { ok: true, claim: { subject: c.subject, verb: c.verb, object: c.object, ...(Array.isArray(c.partition) ? { partition: c.partition.filter((p: unknown) => typeof p === "string") } : {}), ...(c.not === true ? { not: true } : {}) }, cites: chain.map((x: any) => x.cite.trim()), why: `explained by a model: ${why}`.slice(0, 400) };
}
