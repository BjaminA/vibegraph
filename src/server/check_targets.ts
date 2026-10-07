// WHICH DEFINITION A RULE NAMES (2026-10-07, field report). A `callers-only`
// rule on `norm_name` listed 14 offenders in another file — every one a call
// to THAT file's own `norm_name`, a different function with the same name.
// And the spellings people reach for were refused: `tools/collect.py:norm_name`
// read "the IR knows no definition", `import-only` on `collect` read "no file
// imports it" while three did (`from collect import …`; only `tools.collect`
// worked, and nothing said so).
//
// A target is now resolved to a DEFINITION before anything is counted:
//   path/to/file.py:fn     that file's fn
//   pkg.module.fn          when pkg.module is one of this project's modules
//   pkg.module:fn          the same
//   fn                     the one definition of fn — or, when several files
//                          define it, AMBIGUOUS (unverifiable, with the
//                          spellings that would pin it), never merged
// and a call counts only when the linker bound it to that definition. A
// dotted name that is not a project module stays an external API target
// (`lib.fn`), exactly as before.
//
// Pure over the facts; no fs.

export interface DefinitionFact { name: string; file: string }

export interface TargetFacts {
  definedNames: string[];
  /** Every function definition with its file (optional: older builders). */
  definitions?: DefinitionFact[];
  /** file -> its module path (`tools/collect.py` -> `tools.collect`). */
  modules?: Record<string, string>;
}

export type ResolvedTarget =
  | { kind: "project"; name: string; file: string | null; spelled: string }
  | { kind: "external"; spelled: string }
  | { kind: "error"; reason: string };

const stripExt = (f: string) => f.replace(/\.[A-Za-z0-9]+$/, "");

/** The files whose module path or path names `mod`. */
export function filesForModule(facts: TargetFacts, mod: string): string[] {
  const out: string[] = [];
  for (const [file, mp] of Object.entries(facts.modules ?? {})) {
    if (mp === mod || stripExt(file).split("/").join(".") === mod || stripExt(file) === mod) out.push(file);
  }
  return out;
}

/** The project modules a plain name could mean: `collect` -> tools.collect. */
export function modulesNamed(facts: TargetFacts, plain: string): Array<{ file: string; module: string }> {
  const out: Array<{ file: string; module: string }> = [];
  for (const [file, mp] of Object.entries(facts.modules ?? {})) {
    const stem = stripExt(file).split("/").pop();
    if (mp && (mp === plain || mp.split(".").pop() === plain || stem === plain)) out.push({ file, module: mp });
  }
  return out;
}

export function resolveTarget(facts: TargetFacts, target: string): ResolvedTarget {
  const defs = facts.definitions ?? null;
  const defsOf = (name: string) => (defs ?? []).filter((d) => d.name === name);
  // file:fn — a path names the file outright
  const colon = target.lastIndexOf(":");
  if (colon > 0 && !target.startsWith("*.")) {
    const left = target.slice(0, colon), name = target.slice(colon + 1);
    const files = left.includes("/") || /\.[A-Za-z0-9]+$/.test(left)
      ? Object.keys(facts.modules ?? {}).filter((f) => f === left || f.endsWith(`/${left}`))
      : filesForModule(facts, left);
    if (!files.length) return { kind: "error", reason: `no parsed file or module is \`${left}\`` };
    const hit = files.find((f) => defsOf(name).some((d) => d.file === f));
    if (defs && !hit) return { kind: "error", reason: `\`${left}\` defines no function \`${name}\`` };
    return { kind: "project", name, file: hit ?? files[0], spelled: target };
  }
  // pkg.module.fn — only when the prefix is one of this project's modules
  if (target.includes(".") && !target.startsWith("*.") && !target.includes("/")) {
    const dot = target.lastIndexOf(".");
    const mod = target.slice(0, dot), name = target.slice(dot + 1);
    const files = filesForModule(facts, mod);
    if (files.length) {
      const hit = files.find((f) => defsOf(name).some((d) => d.file === f));
      if (defs && !hit) return { kind: "error", reason: `the project module \`${mod}\` defines no function \`${name}\`` };
      return { kind: "project", name, file: hit ?? files[0], spelled: target };
    }
    return { kind: "external", spelled: target };
  }
  if (target.startsWith("*.")) return { kind: "external", spelled: target };
  // a bare name: one definition, or ambiguous
  const files = [...new Set(defsOf(target).map((d) => d.file))];
  if (files.length > 1) {
    return {
      kind: "error",
      reason: `\`${target}\` is AMBIGUOUS: ${files.length} files define it (${files.join(", ")}) and they are different functions. `
        + `Name the one you mean: ${files.map((f) => `\`${f}:${target}\``).join(" or ")}`,
    };
  }
  return { kind: "project", name: target, file: files[0] ?? null, spelled: target };
}

/** Does a resolved call reach this definition? (`toFile` is null for a same-file call.) */
export function callReaches(r: { fromFile: string; toFile: string | null; toName: string }, t: { name: string; file: string | null }): boolean {
  // exact: a method is `Cls.fn`, never the module function `fn`
  if (r.toName !== t.name) return false;
  return t.file === null || (r.toFile ?? r.fromFile) === t.file;
}
