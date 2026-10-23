// The EXTERNAL-SERVICE INVENTORY's shapes and words (2026-10-22, the
// root-cause handoff RC3). Built by src/server/service_inventory.ts from four
// kinds of evidence, each kept with its site: a program a project runs, a
// host its requests reach, a credential it reads, a deploy file it keeps.
// Webview-safe.

export type ServiceEvidenceKind = "program" | "host" | "credential" | "deploy" | "workflow";

export interface ServiceEvidence {
  kind: ServiceEvidenceKind;
  file: string;
  line?: number;
  nodeId?: string;
  /** what was read there: "runs gh", "calls https://api.example.com", "reads OPENAI_API_KEY" */
  detail: string;
  /** what the service is reached through: a program, a library, or a file (`wrangler.toml`) */
  via: string;
}

export interface ServiceEntry {
  name: string;
  /** every program, library or file it is reached through */
  via: string[];
  /** project files the evidence sits in, or that a deploy file names */
  files: string[];
  evidence: ServiceEvidence[];
}

export interface ProgramEntry {
  name: string;
  /** the service running it reaches, when a table knows (service_tables.ts) */
  service: string | null;
  sites: Array<{ file: string; line?: number; nodeId?: string; from: string }>;
}

export interface ServiceInventory {
  services: ServiceEntry[];
  programs: ProgramEntry[];
  /** launches whose program the code does not say */
  unresolved: Array<{ file: string; line?: number; expr: string }>;
}

const where = (e: { file: string; line?: number }) => `${e.file}${e.line ? `:${e.line}` : ""}`;

/** The inventory as Markdown lines (the export's services.md, the CLI). */
export function inventoryInWords(inv: ServiceInventory, max = 6): string[] {
  const out: string[] = [];
  out.push(inv.services.length ? `**Services** (${inv.services.length}), each with the evidence that names it:` : "No external service has evidence in the code or its deploy files.");
  for (const s of inv.services) {
    out.push(`- **${s.name}** through ${s.via.join(", ")}: ${s.evidence.slice(0, max).map((e) => `${e.detail} (${where(e)})`).join("; ")}${s.evidence.length > max ? `; and ${s.evidence.length - max} more` : ""}`);
  }
  if (inv.programs.length) {
    out.push("", `**Programs the code runs** (${inv.programs.length}):`);
    for (const p of inv.programs) out.push(`- \`${p.name}\`${p.service ? ` (${p.service})` : ""}: ${p.sites.slice(0, max).map((x) => `${where(x)}${x.from !== "literal" && x.from !== "command" ? ` (from ${x.from})` : ""}`).join(", ")}${p.sites.length > max ? ` and ${p.sites.length - max} more` : ""}`);
  }
  if (inv.unresolved.length) {
    out.push("", `**Launches whose program the code does not say** (${inv.unresolved.length}):`);
    for (const u of inv.unresolved.slice(0, max * 2)) out.push(`- ${where(u)}: \`${u.expr}\``);
  }
  return out;
}

/** The inventory as a page (the export's services.md, `vibegraph-knowledge services`). */
export function servicesPage(inv: ServiceInventory, project: string): string {
  return [
    `# External services in ${project}`,
    "",
    "Every service the code or its deploy files give evidence for, and the evidence: a program the code runs, a host a request names (directly or through a constant), a credential a vendor's SDK reads, a deploy file or CI workflow. A service named nowhere here has no evidence in what was read (see coverage.md for what was not).",
    "",
    ...inventoryInWords(inv, 8),
    "",
  ].join("\n");
}
