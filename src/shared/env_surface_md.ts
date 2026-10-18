// configuration.md — the configuration surface (env_surface.ts) for a reader
// or an agent. 2026-10-17: ranked by what an unset value does, build-time
// names marked, deploy targets of one kind compared; split out of
// env_surface.ts so that file stays the facts.

import { readEffect, toolThatReads, type EnvRead, type EnvSurface, type EnvVar, type UnsetEffect } from "./env_surface.ts";

const EFFECT_HEAD: Record<UnsetEffect, string> = {
  silent: "Fails silently when unset — an empty value split into a list or gating an early return: no error, the feature just stops",
  unset: "No default — the code reads it bare; what an unset value does next is not visible here",
  loud: "Fails loudly when unset — it raises or exits, so a missing value shows at once",
  defaulted: "Has a default — fine unless the default is wrong for a deployed host",
};
const EFFECT_SHORT: Record<UnsetEffect, string> = { silent: "fails silently", unset: "no default", loud: "fails loudly", defaulted: "has a default" };

function readNote(r: EnvRead): string {
  const parts = [
    r.fallback === "empty" ? "empty fallback" : r.fallback === "value" ? "default given" : r.fallback === "throws" ? "fails at the read" : "",
    r.use === "split" ? "split into a list" : r.use === "exit-silent" ? "returns early when unset" : r.use === "exit-loud" ? "throws or exits when unset" : "",
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
const where = (v: EnvVar) => {
  const r = v.readers.find((x) => readEffect(x) === v.ifUnset) ?? v.readers[0];
  const others = v.readers.length - 1;
  return `\`${r.file}:${r.line}\`${readNote(r)}${others > 0 ? ` +${others} more read${others === 1 ? "" : "s"}` : ""}`;
};
const buildNote = (v: EnvVar) => (v.buildTime ? " · build-time: a change needs a rebuild, not a restart" : "");
const setBy = (v: EnvVar, has: boolean) => (v.declared.length
  ? [...new Set(v.declared.map((d) => `${d.file}:${d.line}${d.from ? ` (${d.from})` : ""}`))].slice(0, 3).join(", ") + (v.declared.length > 3 ? ` +${v.declared.length - 3}` : "")
  : has ? "**nowhere**" : "—");

export function formatEnvSurfaceMd(s: EnvSurface): string {
  const lines = [
    "# Configuration (derived — the environment variables the code reads)",
    "",
    `${s.vars.length} variable(s) are read by name. A read is \`process.env.X\`, \`import.meta.env.X\`, \`os.environ["X"]\`, \`getenv("X")\`, \`env::var("X")\`, or an UPPERCASE \`$X\` a bash script expands and never assigns. A name built at runtime is not a name and is not here. A variable counts as SET when something that reaches a host writes it: an env template, a compose \`environment:\`, a Dockerfile \`ENV\`/\`ARG\`, a systemd \`Environment=\`, a pm2 \`env\` block, a k8s \`env:\` list, or a GitHub workflow (\`env:\` keys, an \`envs:\` passthrough, or a run step that writes it onward).`,
    "",
  ];
  if (s.hasDeclarations) {
    const byName = new Map(s.vars.map((v) => [v.name, v]));
    lines.push(`## Read, but set by nothing that reaches a host (${s.undeclared.length})`, "");
    if (!s.undeclared.length) lines.push("None: every variable the code reads is set somewhere.", "");
    else {
      lines.push("Ranked by what an unset value does. Set each where the deploy writes its environment, or confirm the code's default is right.", "");
      for (const effect of ["silent", "unset", "loud", "defaulted"] as UnsetEffect[]) {
        const vs = s.undeclared.map((n) => byName.get(n)!).filter((v) => v.ifUnset === effect);
        if (!vs.length) continue;
        lines.push(`### ${EFFECT_HEAD[effect]} (${vs.length})`, "", ...vs.map((v) => `- \`${v.name}\` — read in ${where(v)}${buildNote(v)}`), "");
      }
    }
    for (const g of s.targetGaps) {
      const shown = g.rows.slice(0, 40);
      lines.push(`## Set for some ${g.family}, not others (${g.rows.length})`, "",
        "The same kind of target, compared: a variable one sets and another does not is the \"works on one host\" bug.", "",
        `| variable | ${g.targets.map((t) => `\`${t}\``).join(" | ")} |`, `|---|${g.targets.map(() => "---").join("|")}|`,
        ...shown.map((r) => `| \`${r.name}\`${byName.get(r.name)?.buildTime ? " (build-time)" : ""} | ${g.targets.map((t) => (r.setIn.includes(t) ? "set" : "**missing**")).join(" | ")} |`),
        ...(g.rows.length > shown.length ? [`| … ${g.rows.length - shown.length} more | ${g.targets.map(() => "").join(" | ")} |`] : []), "");
    }
    lines.push(`## Declared, but read by nothing the IR sees (${s.unread.length})`, "",
      s.unread.length ? "Possibly stale — or read in a way the IR cannot name (a computed key, a config library), or read by a TOOL rather than by project code (marked)." : "None.", "",
      ...[...new Map(s.unread.map((d) => [d.name, d])).values()].map((d) => `- \`${d.name}\` — ${d.file}:${d.line}${toolThatReads(d.name) ? ` (read by ${toolThatReads(d.name)} itself: expected)` : ""}`), "");
  } else {
    lines.push("The project declares no environment anywhere this can read (no env template, compose, Dockerfile, systemd, pm2, k8s or deploy workflow), so nothing can be checked against a declaration.", "");
  }
  lines.push("## Every variable", "", "| variable | if unset | set by | read in | threads |", "|---|---|---|---|---|");
  for (const v of s.vars) {
    const files = [...new Set(v.readers.map((r) => r.file))];
    lines.push(`| \`${v.name}\`${v.buildTime ? " (build-time)" : ""} | ${EFFECT_SHORT[v.ifUnset]} | ${setBy(v, s.hasDeclarations)} | ${files.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""} | ${v.threads.length} |`);
  }
  return lines.join("\n") + "\n";
}
