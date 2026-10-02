// Injected capabilities in the data architecture (2026-10-02, module 4): the
// same rule the TS linker links by (scripts/frontends/injection_index.mjs),
// over every language's IR, reported with what it could not resolve.

import type { Injection } from "../shared/data_arch_types.ts";
import { injectionIndex } from "../../scripts/frontends/injection_index.mjs";
import { resolveSpecifier } from "../../scripts/frontends/jsts/resolve_spec.mjs";

interface IrFile { language?: string; modulePath?: string; nodes?: Array<Record<string, any>> }

/** An import node → the project file it names (TS by specifier, Python by module path). */
export function importResolver(files: Record<string, IrFile>): (from: string, imp: Record<string, any>) => string | null {
  const byModule = new Map<string, string>();
  for (const [f, ir] of Object.entries(files)) if (ir.modulePath) byModule.set(ir.modulePath, f);
  return (from, imp) => {
    const lang = files[from]?.language;
    if (lang === "jsts") return resolveSpecifier(from, imp.module ?? "", files, imp.aliasTarget) ?? null;
    let mod = String(imp.module ?? "");
    if (mod.startsWith(".")) {
      const dots = /^\.+/.exec(mod)![0].length;
      const base = (files[from]?.modulePath ?? "").split(".").slice(0, -dots);
      mod = [...base, mod.slice(dots)].filter(Boolean).join(".");
    }
    return byModule.get(mod) ?? null;
  };
}

/** `module/depsOn.fn/write.fn` → `depsOn/write`; `module/S3Repo.class/save.fn` → `S3Repo.save`. */
const fnName = (id: string) => id.replace(/^module\//, "").replace(/\.class\//g, ".").replace(/\.fn(\/|$)/g, "$1").replace(/\/$/, "");

export function injectionsOf(files: Record<string, IrFile>): { injections: Injection[]; unresolved: string[] } {
  const { entries } = injectionIndex(files, importResolver(files)) as { entries: any[] };
  const injections: Injection[] = entries.map((e) => ({
    iface: e.iface, property: e.property,
    calls: e.calls.map((c: any) => ({ file: c.file, line: c.line, callee: c.callee })),
    implementations: e.implementations.map((i: any) => ({ file: i.file, line: i.line, fn: i.id ? fnName(i.id) : `forwarded: ${i.value ?? "?"}`, test: i.test, ...(i.structural ? { structural: i.structural } : {}) })),
  }));
  const unresolved = injections
    .filter((j) => !j.implementations.some((i) => !i.test))
    .map((j) => `\`${j.iface}.${j.property}\` is called at ${j.calls.map((c) => `${c.file}:${c.line}`).join(", ")} and nothing in the project implements it${j.implementations.length ? ` (only ${j.implementations.length} test fake(s))` : ""}`);
  return { injections, unresolved };
}
