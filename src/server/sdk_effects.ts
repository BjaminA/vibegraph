// SDK EFFECT ATTRIBUTION (2026-10-02, module 3). Every call `recv.Method(...)`
// whose receiver resolves to a third-party tool with an I/O role (receiver_types.ts)
// becomes an SdkCall: the tool, how the receiver was tied to it, the effect its
// verb names (sdk_verbs.ts), and its payload keys — including calls nested in
// arguments, `await` and wrappers (`assertOk(await client.SaveAccess(...))`),
// which the parser mints as their own nodes.
//
// Not counted: constructors (`new Kafka()` makes the object, it does not use
// it) and listener wiring (`client.on("ready", …)`, the stack attribution's
// own ruling). Said, not dropped: a call that LOOKS like an effect, in a file
// that imports an I/O tool, whose receiver could not be tied to the tool.

import type { SdkCall } from "../shared/data_arch_types.ts";
import { effectOf, verbWords, VERB_EFFECTS } from "../shared/sdk_verbs.ts";
import { isTestFile } from "../shared/path_match.ts";
import { ReceiverResolver, type Binding, type Files } from "./receiver_types.ts";

/** Roles whose calls cross the process boundary (stack_taxonomy StackRole). */
export const IO_ROLES = new Set(["platform", "db", "cache", "queue", "cloud", "http-client", "model-api", "remote", "agent-protocol"]);
const WIRING = new Set(["on", "off", "once", "addListener", "removeListener", "removeAllListeners", "prependListener", "addEventListener", "removeEventListener", "setMaxListeners", "listenerCount"]);

interface StackTool { tool: string; role: string; origin: string }
export interface StackLike { tools?: StackTool[]; importsByFile?: Record<string, Binding[]> }

/** A spec's tool: the stack's own name for it (package root, scope/package, dotted root). */
export function specToTool(tools: StackTool[]): (spec: string) => string | null {
  const byName = new Map(tools.filter((t) => t.origin !== "project").map((t) => [t.tool, t]));
  return (spec) => {
    const s = spec.replace(/^node:/, "");
    const parts = s.startsWith("@") ? [s.split("/").slice(0, 2).join("/"), s.split("/")[0]] : [s.split("/")[0], s.split(".")[0]];
    for (const p of [s, ...parts]) if (byName.has(p)) return p;
    return null;
  };
}

export interface SdkScan { calls: SdkCall[]; untied: string[] }

export function scanSdkCalls(files: Files, stack: StackLike): SdkScan {
  const tools = stack.tools ?? [];
  const role = new Map(tools.filter((t) => t.origin !== "project").map((t) => [t.tool, t.role]));
  const toolOf = specToTool(tools);
  const resolver = new ReceiverResolver(files, stack.importsByFile ?? {}, toolOf);
  const calls: SdkCall[] = [];
  const untied: string[] = [];
  const seen = new Set<string>();
  for (const [file, ir] of Object.entries(files)) {
    const ioImports = [...new Set((stack.importsByFile?.[file] ?? []).filter((b) => !b.project).map((b) => toolOf(b.spec)).filter((t): t is string => !!t && IO_ROLES.has(role.get(t) ?? "")))];
    for (const n of ir.nodes ?? []) {
      const any = n as any;
      const callee = String(any.funcName ?? any.callTarget ?? "");
      if (!/^[A-Za-z_$][\w$]*(\??\.[\w$#]+)+$/.test(callee)) continue;
      if (/^\s*(await\s+)?new\s/.test(any.preview ?? "")) continue;
      const method = callee.split(".").pop()!;
      if (WIRING.has(method)) continue;
      const key = `${file}:${n.line}:${callee}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = resolver.toolOfCall(callee, file, any);
      if (!r || !IO_ROLES.has(role.get(r.tool) ?? "")) {
        if (!r && ioImports.length && VERB_EFFECTS[verbWords(method)[0] ?? ""] && !isTestFile(file) && resolver.originUnknown(callee, file, any)) untied.push(`${file}:${n.line} \`${callee}\` — in a file importing ${ioImports.join(", ")}; its receiver could not be tied to a tool`);
        continue;
      }
      const keys = ((any.argKeys ?? []) as string[][]).flat().filter((k) => !k.startsWith("...") && !k.startsWith("["));
      calls.push({
        file, line: n.line ?? 0, callee, method, tool: r.tool, how: r.how, effect: effectOf(method, keys),
        ...(keys.length ? { keys } : {}), ...(isTestFile(file) ? { test: true } : {}),
      } as SdkCall);
    }
  }
  calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { calls, untied };
}

export const sdkCallsOf = (files: Files, stack: StackLike): SdkCall[] => scanSdkCalls(files, stack).calls;
