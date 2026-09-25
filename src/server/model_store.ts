// M-PROVIDER — model routes on disk + the local-endpoint probe.
//
// The tier settings used to live only in the webview's localStorage and
// were re-sent to the server on every page load. With providers and
// endpoints in them they are project configuration: `.vibegraph/models.json`
// is the source of truth, loaded at boot and rewritten by the WS setter, so
// a headless driver (drive_work_run.mjs) or an MCP-started run routes the
// same way the board does. Every read passes sanitiseTiers — a hand-edited
// file with a bad endpoint falls back to defaults, never half-applies.
//
// The probe is what the Models panel's "Test" button runs, SERVER-side (the
// webview cannot reach a local server across origins): version, the model
// list, and — when a model is named — one tiny generation with its measured
// tokens per second. Endpoints are validated first; only Ollama's own
// read/generate routes are ever called.

import * as fs from "fs";
import * as path from "path";
import {
  sanitiseTiers, isSafeEndpoint, isSafeModelName, normaliseEndpoint,
  type TierSettings,
} from "../shared/model_tiers.ts";

export const MODELS_FILE = path.join(".vibegraph", "models.json");

export function loadModelRoutes(projectRoot: string): TierSettings | null {
  const file = path.join(projectRoot, MODELS_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return sanitiseTiers(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch (e) {
    console.warn(`  [models] ${MODELS_FILE} unreadable (${(e as Error).message}) — defaults`);
    return null;
  }
}

export function saveModelRoutes(projectRoot: string, tiers: TierSettings): void {
  const file = path.join(projectRoot, MODELS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sanitiseTiers(tiers), null, 2) + "\n", "utf-8");
}

export interface EndpointProbe {
  endpoint: string;
  ok: boolean;
  version?: string;
  models?: string[];
  /** Present when a model was named and the generation ran. */
  model?: string;
  tokPerSec?: number;
  loadSeconds?: number;
  error?: string;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Probe an Ollama endpoint: /api/version, /api/tags, and (optionally) a
 * four-token /api/generate on `model` to measure tokens per second. Never
 * throws — the result says what failed. */
export async function probeOllamaEndpoint(endpointRaw: unknown, modelRaw?: unknown): Promise<EndpointProbe> {
  if (!isSafeEndpoint(endpointRaw)) return { endpoint: String(endpointRaw ?? ""), ok: false, error: "endpoint must be an http(s) URL without credentials, query, or fragment" };
  const endpoint = normaliseEndpoint(endpointRaw);
  const out: EndpointProbe = { endpoint, ok: false };
  try {
    const v = await fetchJson(`${endpoint}/api/version`, { method: "GET" }, 4000);
    out.version = typeof v?.version === "string" ? v.version : "unknown";
  } catch (e: any) {
    out.error = `unreachable: ${e?.name === "AbortError" ? "timed out" : (e?.message ?? e)}`;
    return out;
  }
  try {
    const tags = await fetchJson(`${endpoint}/api/tags`, { method: "GET" }, 6000);
    out.models = Array.isArray(tags?.models) ? tags.models.map((m: any) => String(m.name)).filter(Boolean) : [];
  } catch (e: any) {
    out.models = [];
    out.error = `model list failed: ${e?.message ?? e}`;
  }
  out.ok = true;
  if (modelRaw === undefined || modelRaw === null || modelRaw === "") return out;
  if (!isSafeModelName(modelRaw)) { out.error = "model name has invalid characters"; return out; }
  out.model = modelRaw;
  if (out.models && out.models.length && !out.models.includes(modelRaw)) {
    out.error = `model ${modelRaw} is not on this server (pull it first)`;
    return out;
  }
  try {
    const g = await fetchJson(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelRaw, prompt: "Reply with exactly: OK", stream: false, options: { num_predict: 4 } }),
    }, 180_000);
    const evalCount = Number(g?.eval_count ?? 0);
    const evalNs = Number(g?.eval_duration ?? 0);
    out.tokPerSec = evalCount > 0 && evalNs > 0 ? Math.round((evalCount / (evalNs / 1e9)) * 10) / 10 : undefined;
    out.loadSeconds = Math.round((Number(g?.load_duration ?? 0) / 1e9) * 10) / 10;
  } catch (e: any) {
    out.error = `generation failed: ${e?.name === "AbortError" ? "timed out" : (e?.message ?? e)}`;
  }
  return out;
}
