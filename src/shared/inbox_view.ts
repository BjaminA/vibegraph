// An inbox item as chips (2026-10-08, Ben: "the inbox should be modularly
// chip-ified"). The server sends each item as an id, a kind, a title and
// detail lines (inbox.ts — the same list the CLI prints); this turns ANY item
// into the panel's one frame without a renderer per kind:
//
//   subject   the chip of what the item is about, read off its id
//             (`plan:processes:api` → a process chip, `rule:c4` → a rule)
//   facts     one bullet per detail line, labelled by its shape —
//             `field: a → b` changes, `effect: …` effect, a backticked command
//             do, the first other line says, the rest evidence — with every
//             reference inside it (a file path, a box id) drawn as a chip
//
// A new inbox kind needs one row in SUBJECT; a new detail line needs nothing.
// Pure and webview-safe.

import type { ChipRef, ItemFact, KindId } from "./kinds.ts";

export interface InboxItemLike { id: string; kind: string; title: string; detail: string[]; decidable: boolean }

/** A plan section's items, by kind. */
const PLAN_SECTION: Record<string, KindId> = {
  processes: "process", modules: "module", stores: "store", principals: "identity", stack: "module",
  boundaries: "json", threads: "process", flows: "process", policies: "rule",
};
/** A box id's prefix, by kind. */
const BOX_PREFIX: Record<string, KindId> = { cluster: "process", tool: "module", zone: "zone", store: "store", actor: "identity", decision: "rule" };

/** What the item is about, as one chip; null when the id names nothing. */
export function inboxSubject(item: InboxItemLike): ChipRef | null {
  const [kind, ...rest] = item.id.split(":");
  const arg = rest.join(":");
  switch (kind) {
    case "plan": {
      const [section, ...ids] = arg.split(":");
      const id = ids.join(":");
      return { kind: PLAN_SECTION[section] ?? "rule", id, label: id };
    }
    case "rule": return { kind: "rule", id: arg };
    case "rule-change": return { kind: "rule", id: arg.split(":")[0] };
    case "scope": return boxChip(arg);
    case "skill": return { kind: "process", id: arg };
    case "spec": return { kind: "module", id: arg };
    case "brief": return { kind: "type", id: `brief:${arg}`, label: `Brief · ${arg}` };
    case "objective": return { kind: "question", id: arg, label: "objective" };
    case "decision": return { kind: "question", id: arg };
    case "sensor": case "drift": case "questions": return { kind: "question", id: arg || kind, label: kind === "questions" ? "questions" : "drift" };
    case "groups": case "regroup": return { kind: "module", id: "groups", label: "groups" };
    case "claim": return { kind: "question", id: arg, label: `claim ${arg}` };
    default: return null;
  }
}

function boxChip(id: string): ChipRef {
  const prefix = id.split(":")[0];
  const kind = BOX_PREFIX[prefix] ?? "module";
  return { kind, id, label: id.slice(prefix.length + 1) || id };
}

// a file path (with an optional :line), or a box id
const REF = /((?:[\w@.-]+\/)*[\w@.-]+\.(?:tsx?|mjs|cjs|jsx?|py|sh|rs|cpp|cc|hpp|h|json|md|ya?ml|toml)(?::\d+)?)|\b((?:cluster|tool|zone|store|actor|decision):[^\s,;"'`)\]]+)/g;

/** A line's text with every reference it names as a chip. */
export function chipifyLine(line: string): Array<ChipRef | string> {
  const out: Array<ChipRef | string> = [];
  let last = 0;
  for (const m of line.matchAll(REF)) {
    const at = m.index ?? 0;
    const before = line.slice(last, at).trim();
    if (before) out.push(before);
    if (m[1]) {
      const [file] = m[1].split(/:(?=\d+$)/);
      out.push({ kind: "path", id: file, label: m[1] });
    } else out.push(boxChip(m[2]));
    last = at + m[0].length;
  }
  const after = line.slice(last).trim();
  if (after) out.push(after);
  return out;
}

const CHANGE = /^([\w.]+): (.*) → (.*)$/;
/** a whole value that is one file path */
const A_FILE = /^(?:[\w@.-]+\/)*[\w@.-]+\.(?:tsx?|mjs|cjs|jsx?|py|sh|rs|cpp|cc|hpp|h|json|md|ya?ml|toml)$/;

/** One labelled bullet per detail line. */
export function inboxFacts(item: InboxItemLike): ItemFact[] {
  let said = false;
  return item.detail.map((line): ItemFact => {
    if (line.startsWith("effect: ")) return { label: "effect", parts: chipifyLine(line.slice("effect: ".length)) };
    const c = CHANGE.exec(line);
    if (c) return { label: "changes", parts: [c[1], ...chipifyLine(c[2]), "→", ...chipifyLine(c[3])] };
    if (/`[^`]+`/.test(line) && /^(re-|close|run|add|use)/i.test(line)) return { label: "do", text: line.replace(/`/g, "") };
    const label = said ? "evidence" : "says";
    said = true;
    return { label, parts: objectParts(line) ?? chipifyLine(line) };
  });
}

/** A proposed item sent whole (`{"id":…,"at":"archiver/"}`) as its fields:
 *  `label serves at` words with a folder or file as a chip. Null when the
 *  line is not a whole JSON object (the server cuts long ones). */
function objectParts(line: string): Array<ChipRef | string> | null {
  if (!line.startsWith("{")) return null;
  let o: unknown;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out: Array<ChipRef | string> = [];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === "id" || k === "status" || v === null || v === undefined || v === "") continue;
    const text = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    out.push(`${out.length ? "· " : ""}${k}`);
    if (typeof v === "string" && (/\/$/.test(v) || A_FILE.test(v))) out.push({ kind: "path", id: v, label: v });
    else out.push(text);
  }
  return out.length ? out : null;
}
