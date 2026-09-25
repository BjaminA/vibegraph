// M-LANG1 (PLAN-M-LANG.md) — the one language table. Webview-safe: pure
// data + pure string functions, no node imports. The server-side frontend
// registry (src/server/languages.ts) builds command dispatch on top of
// this; the webview reads Monaco languages and capability gates from it.
//
// A language appears here ONLY when its frontend milestone lands — file
// discovery, watching, and parsing route through this table, so an
// unregistered language literally cannot enter the pipeline.

import type { LanguageId } from "./protocol";

export type { LanguageId };

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Extensions including the dot, lower-case (".py"). First is canonical. */
  extensions: string[];
  /**
   * M-CMD.1 — interpreter basenames this language answers to in a `#!` line,
   * for files that carry NO extension. a private production codebase's `bin/ops-run` is the
   * case: a `#!/usr/bin/env bash` script with no suffix, the only command a
   * Volt peer may execute, and invisible to an extension-only walker.
   *
   * Registry-shaped on purpose (the M-LANG1 rule: a language enters the
   * pipeline by registration, never by a special case somewhere else). A
   * language with no plausible shebang simply omits it, and an extensionless
   * file whose interpreter no language claims stays out of the IR.
   */
  interpreters?: string[];
  /** Monaco editor language id ("python" | "shell" | "typescript" | "cpp"). */
  monacoLanguage: string;
  /** Markdown fence tag for LLM prompts (```python). */
  fenceTag: string;
  /**
   * What the runtime can actually DO for this language. UI affordances
   * must gate on these — an edit button for a language with no rewriter
   * would violate affordance-must-match-operation.
   */
  capabilities: {
    /** CST-patch edit path (rewriter + formatter + diff confinement). */
    edit: boolean;
    /** run-block / run-to-node execution + synthesis floors. */
    run: boolean;
    /**
     * PLAN-M-RUNTIME phase 3 — TRACE runs: execute an entry point once and
     * record what every call site really called.
     *
     * Separate from `run` on purpose. They are different operations behind
     * different floors, and conflating them would be a safety bug: bash has
     * a trace floor (scripts/trace_bash.mjs neutralises PATH so no external
     * program can execute) and NO run floor, so `trace: true, run: false` is
     * the honest pair. Turning `run` on to unlock tracing would have handed
     * bash the run-to-node and Observe buttons, which have nothing behind
     * them.
     */
    trace: boolean;
    /** The PyTorch architecture view. */
    architecture: boolean;
  };
}

export const LANGUAGES: readonly LanguageInfo[] = [
  {
    id: "python",
    label: "Python",
    extensions: [".py"],
    interpreters: ["python", "python3"],
    monacoLanguage: "python",
    fenceTag: "python",
    capabilities: { edit: true, run: true, trace: true, architecture: true },
  },
  {
    // M-LANG2 read-only; M-LANG4 landed the edit floor
    // (rewrite_bash.mjs: span-splice + shfmt candidates under the SAME
    // diff-confinement check as cst_rewrite.py, shared-vector-pinned).
    // shfmt missing ⇒ the verified-but-unformatted candidate is used
    // ({formatted:false}) — the exact black-unavailable ladder; the
    // confinement check is never skipped. run has no milestone yet.
    interpreters: ["bash", "sh"],
    id: "bash",
    label: "Bash",
    extensions: [".sh", ".bash"],
    monacoLanguage: "shell",
    fenceTag: "bash",
    // trace WITHOUT run (PLAN-M-RUNTIME phase 3): the trace floor makes
    // external execution impossible rather than predicting it, which is the
    // only shape that works for a language whose whole job is to shell out.
    // There is still no RUN floor, so run-to-node and Observe stay off.
    capabilities: { edit: true, run: false, trace: true, architecture: false },
  },
  {
    // M-LANG3 — read-only frontend (tree-sitter-typescript). ONLY
    // .ts/.tsx: registering .js/.jsx would pull the M19 system tier's
    // deliberately TEXT-scanned web frontends into the IR
    // (test/fixtures/system/system_demo/web is the collision proof) —
    // that tension gets its own decision before .js registration.
    // M-LANG5b landed the edit floor (rewrite_jsts.mjs: span-splice +
    // prettier candidates — SPAN-SCOPED via rangeStart/rangeEnd, the
    // project's .prettierrc respected — under the SHARED confinement
    // check; prettier unavailable ⇒ verified-but-unformatted
    // {formatted:false}, the check never skipped). run: no milestone.
    id: "jsts",
    label: "TypeScript",
    // M-CMD.1 — `.mjs`/`.cjs` JOIN `.ts`/`.tsx`; `.js`/`.jsx` still do not.
    // The deferral above is about BROWSER-SERVED frontend files, and the
    // collision it names is one file: system_demo/web/src/api.jsx. Measured
    // before changing it: (1) `_SCAN_EXT` in build_system_tier.py already
    // contains `.ts` and `.tsx`, which ARE registered, so being text-scanned
    // has never precluded registration; (2) every `.mjs` in this repo's
    // fixtures is a spawn STUB (fake_claude_*.mjs, fake_worker.mjs) that no
    // VG_FIXTURE ever points at, so nothing here changes shape. The cost of
    // leaving them out was measured on a real codebase: 58 of 77 parsed
    // `.sh` files existed only to exec a sibling `.mjs` nobody parsed, so
    // every one of those threads stopped at the doorway
    // (an internal field review B1). `.js`/`.jsx` keep their deferral.
    extensions: [".ts", ".tsx", ".mjs", ".cjs"],
    interpreters: ["node"],
    monacoLanguage: "typescript",
    fenceTag: "typescript",
    capabilities: { edit: true, run: false, trace: false, architecture: false },
  },
  {
    // M-LANG5a — read-only frontend (tree-sitter-cpp), NO
    // compile_commands.json: linking follows the header convention
    // (include "x.h" → x.h + companion x.cpp/.cc), overloads refuse to
    // link (unresolved — a named resolution gap), template dispatch is
    // dynamic. Edit floor: clang-format is the named formatter when a
    // milestone picks it up; until then read-only.
    id: "cpp",
    label: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
    monacoLanguage: "cpp",
    fenceTag: "cpp",
    capabilities: { edit: false, run: false, trace: false, architecture: false },
  },
  {
    // M-RUST — read-only frontend (tree-sitter-rust). Linking follows
    // CARGO convention, which unlike C++'s header convention is
    // deterministic: the parser reads the manifest above each file and
    // stamps `crateName`/`cratePath`, so `mod x;` and `use crate::a::b`
    // resolve to real files. Rust has no overloading, so a PATH call
    // (`Router::new`) links; a METHOD call needs the receiver's type and
    // stays `dynamic`; a turbofish is compile-time dispatch and stays
    // `dynamic`. Capabilities all false: rustfmt is the named formatter
    // if an edit milestone ever picks Rust up, and a run floor for a
    // COMPILED language needs a build plus a consent story for build.rs
    // (which executes arbitrary code at build time — the import-time
    // effects class), so it is its own design conversation.
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    monacoLanguage: "rust",
    fenceTag: "rust",
    capabilities: { edit: false, run: false, trace: false, architecture: false },
  },
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export function languageById(id: string | null | undefined): LanguageInfo | null {
  return (id && BY_ID.get(id as LanguageId)) || null;
}

/** Match a file path (or bare filename) to a registered language by extension. */
export function languageForPath(filePath: string): LanguageInfo | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  for (const lang of LANGUAGES) {
    if (lang.extensions.includes(ext)) return lang;
  }
  return null;
}

/**
 * M-CMD.1 — the language a `#!` line names, or null.
 *
 * Handles both spellings (`#!/bin/bash`, `#!/usr/bin/env python3`) and
 * ignores arguments after the interpreter (`#!/bin/sh -e`). The match is on
 * the interpreter's BASENAME against the registry's `interpreters`, with a
 * trailing version digit tolerated (`python3.11` → `python3` → python), so
 * an interpreter no registered language claims returns null rather than a
 * guess. Pure string work: the caller does the reading.
 */
export function languageForShebang(firstLine: string): LanguageInfo | null {
  if (!firstLine.startsWith("#!")) return null;
  const words = firstLine.slice(2).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // `env` delegates to its first non-flag argument (`env -S node --flag`).
  let interp = words[0];
  if (interp.split("/").pop() === "env") {
    const next = words.slice(1).find((w) => !w.startsWith("-"));
    if (!next) return null;
    interp = next;
  }
  const base = (interp.split("/").pop() ?? "").toLowerCase();
  const candidates = [base, base.replace(/[0-9.]+$/, "")];
  for (const lang of LANGUAGES) {
    if (!lang.interpreters) continue;
    if (candidates.some((c) => c && lang.interpreters!.includes(c))) return lang;
  }
  return null;
}

/**
 * Monaco language for a file path. Falls back to python: pre-M-LANG1
 * payloads carry no language, and every file the server serves today IS
 * python — an unknown path in the webview means "old data", not "new
 * language" (new languages arrive here by registration, never by default).
 */
export function monacoLanguageForPath(filePath: string | null | undefined): string {
  return languageForPath(filePath ?? "")?.monacoLanguage ?? "python";
}

/**
 * Capability gates for a file path (python defaults for unknown/absent
 * paths, mirroring monacoLanguageForPath's fallback rationale). UI
 * affordances MUST consult this before rendering edit/run/Intent
 * actions — an edit button on a language with no rewriter would violate
 * affordance-must-match-operation.
 */
export function capabilitiesForPath(
  filePath: string | null | undefined,
): LanguageInfo["capabilities"] {
  return (
    languageForPath(filePath ?? "")?.capabilities
    ?? { edit: true, run: true, trace: true, architecture: true }
  );
}
