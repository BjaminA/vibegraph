// REFUSED ATTEMPTS ARE NOT WRITES (2026-10-06, direction review M5). A probe
// or a live check deliberately tries writes the platform must refuse; drawn
// as writes, they put the wrong process on a zone ("the app writes status").
// A write is an ATTEMPT when:
//
//   * its file is declared negative (`.vibegraph/operations.json` `negative`:
//     globs) — the project says so outright; or
//   * it sits, directly or through its enclosing function at EVERY call site,
//     inside an attempt WRAPPER: a call named like one (`attempt`,
//     `expectRefused`, `assert.rejects`, `….rejects`) or a project function
//     shaped like one (its `try` calls one of its own parameters and its
//     `catch` returns) — `attempt(writeAs(app, path, doc))`.
//
// What the attempt expects is read from the text around it: `REFUSED` /
// `DENIED` / `FORBIDDEN` / rejects → refused; `ALLOWED` → a control write the
// platform should accept, which stays a WRITE. Read from IR nodes (parentId
// chains, call args), never from source text; a call through a value passed
// around is not followed.

import { pathAllowed } from "../shared/path_match.ts";

interface IrNode { id: string; type?: string; name?: string; line?: number; parentId?: string | null; callTarget?: string; funcName?: string; args?: string[]; params?: string[] }
type Files = Record<string, { nodes?: IrNode[] }>;

export interface Attempt { expect: "refused" | "unknown"; via: string }

const WRAPPER = /^(attempt\w*|try(To|Write|Call)?\w*|expect(Refus|Deni|Reject|Fail|Error|Throw|Forbid)\w*|assert(Rejects|Throws|Refused|Denied)\w*|rejects|throws|probe\w*|mustFail\w*|shouldFail\w*)$/;
const REFUSED = /\b(REFUSED|DENIED|FORBIDDEN|UNAUTHORI[SZ]ED|PERMISSION_DENIED|rejects|refused|denied|forbidden)\b/;
const ALLOWED = /\b(ALLOWED|ACCEPTED|SUCCEEDS?)\b/;

const lastSeg = (callee: string) => callee.replace(/\(.*$/, "").split(".").pop() ?? "";

export class AttemptFinder {
  private byId = new Map<string, Map<string, IrNode>>();
  private callsByName = new Map<string, Array<{ file: string; node: IrNode }>>();
  private shaped = new Map<string, boolean>(); // file::fnName → attempt-shaped
  private files: Files;
  private negative: readonly string[];
  constructor(files: Files, negative: readonly string[] = []) {
    this.files = files;
    this.negative = negative;
    for (const [file, ir] of Object.entries(files)) {
      const m = new Map<string, IrNode>();
      for (const n of ir?.nodes ?? []) {
        if (!m.has(n.id)) m.set(n.id, n);
        if (n.type === "call") {
          const name = lastSeg(String(n.callTarget ?? n.funcName ?? ""));
          if (name) this.callsByName.set(name, [...(this.callsByName.get(name) ?? []), { file, node: n }]);
        }
      }
      this.byId.set(file, m);
    }
  }

  private parent(file: string, n: IrNode): IrNode | undefined {
    return n.parentId ? this.byId.get(file)?.get(n.parentId) : undefined;
  }

  /** A project function shaped like a wrapper: `try { … param() … } catch { return … }`. */
  private attemptShaped(file: string, name: string): boolean {
    const key = `${file}::${name}`;
    if (this.shaped.has(key)) return this.shaped.get(key)!;
    const nodes = this.files[file]?.nodes ?? [];
    const fn = nodes.find((n) => n.type === "function_def" && n.name === name);
    let ok = false;
    if (fn) {
      const params = (fn.params ?? []).map((p) => String(p).replace(/^\.\.\./, "").split(/[?:=\s]/)[0]);
      const inTry = nodes.some((n) => n.type === "call" && n.id.startsWith(`${fn.id}/try@`) && params.includes(lastSeg(String(n.callTarget ?? n.funcName ?? ""))));
      const catchReturns = nodes.some((n) => n.type === "return_stmt" && /^.+\/(except|catch)@\d+\//.test(n.id) && n.id.startsWith(`${fn.id}/`));
      ok = inTry && catchReturns;
    }
    this.shaped.set(key, ok);
    return ok;
  }

  private isWrapper(file: string, n: IrNode): boolean {
    const callee = String(n.callTarget ?? n.funcName ?? "");
    const last = lastSeg(callee);
    return WRAPPER.test(last) || /\.rejects$/.test(callee) || this.attemptShaped(file, last);
  }

  /** The wrapper a call sits inside, and the text around it, or null. An
   *  inline arrow's call is parented to the OUTER call, beside the wrapper
   *  that holds it (`attempt(() => write(…))`): a sibling wrapper whose
   *  arguments spell this call counts too. */
  private wrapped(file: string, n: IrNode): { wrapper: string; text: string } | null {
    let text = "";
    const spelled = `${lastSeg(String(n.callTarget ?? n.funcName ?? ""))}(`;
    const nodes = this.files[file]?.nodes ?? [];
    for (let p = this.parent(file, n), hops = 0; p && hops < 8; p = this.parent(file, p), hops++) {
      if (p.type === "function_def") break;
      text += ` ${(p.args ?? []).join(" ")}`;
      // (the IR keeps an inline arrow out of the wrapper's args, so a wrapper
      // beside it on the same line holds it too)
      const sib = nodes.find((s) => s.parentId === p!.id && s.id !== n.id && s.type === "call" && this.isWrapper(file, s)
        && ((s.args ?? []).some((a) => a.includes(spelled)) || (s.line !== undefined && s.line === n.line)));
      if (sib) return { wrapper: String(sib.callTarget ?? sib.funcName), text: `${text} ${(sib.args ?? []).join(" ")}` };
      if (p.type === "call" && this.isWrapper(file, p)) {
        // the text the wrapper's result lands in (`{ expect: "REFUSED", got: … }`)
        for (let q = this.parent(file, p), k = 0; q && k < 3 && q.type !== "function_def"; q = this.parent(file, q), k++) text += ` ${(q.args ?? []).join(" ")}`;
        return { wrapper: String(p.callTarget ?? p.funcName), text };
      }
    }
    return null;
  }

  private enclosingFn(file: string, n: IrNode): IrNode | undefined {
    for (let p = this.parent(file, n), hops = 0; p && hops < 12; p = this.parent(file, p), hops++) if (p.type === "function_def") return p;
    return undefined;
  }

  /** Is the write at (file, nodeId) an attempt? null = a write. */
  of(file: string, nodeId: string | undefined): Attempt | null {
    if (this.negative.length && pathAllowed(file, this.negative)) return { expect: "unknown", via: `${file} is declared negative (.vibegraph/operations.json)` };
    const n = nodeId ? this.byId.get(file)?.get(nodeId) : undefined;
    if (!n) return null;
    const judge = (w: { wrapper: string; text: string }, where: string): Attempt | null =>
      ALLOWED.test(w.text) && !REFUSED.test(w.text) ? null : { expect: REFUSED.test(w.text) ? "refused" : "unknown", via: `inside ${w.wrapper}(…) ${where}` };
    const direct = this.wrapped(file, n);
    if (direct) return judge(direct, `at ${file}:${n.line ?? "?"}`);
    // through its enclosing function: every call site wrapped
    const fn = this.enclosingFn(file, n);
    if (!fn?.name) return null;
    const sites = (this.callsByName.get(fn.name) ?? []).filter((c) => c.node.id !== n.id);
    if (!sites.length) return null;
    const wraps = sites.map((c) => this.wrapped(c.file, c.node));
    if (wraps.some((w) => !w)) return null;
    const verdicts = wraps.map((w, i) => judge(w!, `(${fn.name} called at ${sites[i].file}:${sites[i].node.line ?? "?"})`));
    // some call sites expect the write to be ALLOWED (a control): those are real writes
    if (verdicts.some((v) => !v)) return null;
    return { expect: verdicts.every((v) => v!.expect === "refused") ? "refused" : "unknown", via: verdicts[0]!.via + (verdicts.length > 1 ? ` and ${verdicts.length - 1} more` : "") };
  }
}
