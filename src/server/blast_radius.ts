// A2 (PLAN-v6) — blast-radius / impact analysis. Before editing node N, what
// depends on it? Builds a reverse/caller index from the IR's reference edges
// and reports: the statically-linked callers, the threads that traverse N, and
// — crucially, HONESTLY — that callers reaching N through a dynamic/unresolved
// hop emit NO edge and are therefore not enumerable (with name-matched suspects
// surfaced separately, clearly unverified).
//
// Pure: the server adapter normalises projectParse (relative keys; reference
// edges with targetFile relativised) and latestThreads into the inputs below,
// so this is unit-testable without a server. Reference-edge shape (verified):
//   same-file:  { source, target }
//   cross-file: { source, target, targetFile, qualifiedTarget }

export interface BlastNode {
  id: string;
  type?: string;
  name?: string;
  parentId?: string;
}

/** A reference edge, normalised: targetFile is the RELATIVE key of the callee's
 *  file, or undefined for a same-file call. */
export interface RefEdge {
  source: string;
  target: string;
  targetFile?: string;
  qualifiedTarget?: string;
}

export interface BlastFile {
  nodes: BlastNode[];
  refEdges: RefEdge[];
}

export interface BlastThread {
  entryPointId: string;
  qualifiedName: string;
  nodes: Array<{ irNodeId: string | null; file: string | null; kind: string; label: string }>;
}

export interface Dependent {
  /** The call-site node that references the target. */
  callerNodeId: string;
  file: string;
  /** The function the call site sits in (the unit that breaks if N changes). */
  enclosingFn: string | null;
  enclosingFnId: string | null;
  qualifiedTarget?: string;
}

export interface HiddenCallerSuspect {
  threadNodeId: string;
  label: string;
  kind: "dynamic" | "unresolved";
  inThread: string;
}

export interface BlastRadius {
  target: { nodeId: string; file: string; name?: string; type?: string };
  /** Statically-linked callers (the reverse index) — the part we can prove. */
  dependents: Dependent[];
  /** Entry-point threads whose flow passes through N. */
  threads: Array<{ entryPointId: string; qualifiedName: string }>;
  /** UNVERIFIED: dynamic/unresolved terminals whose name matches N — a caller
   *  might reach N through one of these, but the linker emitted no edge, so this
   *  is a name-match heuristic, not proof. */
  possibleHiddenCallers: HiddenCallerSuspect[];
  totals: { dependents: number; threads: number; possibleHiddenCallers: number };
  notes: string[];
}

/** Last dotted identifier of a terminal label: "conn.execute" → "execute". */
function lastIdent(label: string): string {
  const parts = label.split(".");
  return parts[parts.length - 1] ?? label;
}

export function computeBlastRadius(
  targetFile: string,
  targetNodeId: string,
  files: Record<string, BlastFile>,
  threads: BlastThread[],
): BlastRadius {
  const targetNode = files[targetFile]?.nodes.find((n) => n.id === targetNodeId);

  // Reverse index: every reference edge across the project whose resolved
  // (targetFile, target) is N is a caller.
  const dependents: Dependent[] = [];
  for (const [srcFile, file] of Object.entries(files)) {
    const byId = new Map(file.nodes.map((n) => [n.id, n]));
    for (const e of file.refEdges) {
      const resolvedTargetFile = e.targetFile ?? srcFile;
      if (resolvedTargetFile !== targetFile || e.target !== targetNodeId) continue;
      // Enclosing function of the call site (the unit that depends on N).
      let fn: BlastNode | undefined;
      let cur = byId.get(e.source);
      const seen = new Set<string>();
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const p = byId.get(cur.parentId);
        if (p?.type === "function_def") { fn = p; break; }
        cur = p;
      }
      dependents.push({
        callerNodeId: e.source,
        file: srcFile,
        enclosingFn: fn?.name ?? null,
        enclosingFnId: fn?.id ?? null,
        qualifiedTarget: e.qualifiedTarget,
      });
    }
  }

  // Threads affected by editing N: those containing N directly (a recursed
  // step) OR any DIRECT caller's enclosing function. The thread representation
  // of a call differs (a same-file resolved call recurses to a step under N's
  // def-id; a cross-file call appears as an external terminal under the
  // call-SITE id), so matching only N's def-id would miss the common
  // cross-file case — match the callers' functions too. File-qualified, since
  // structural ids can collide across files.
  const reachingKeys = new Set<string>([`${targetFile}::${targetNodeId}`]);
  for (const d of dependents) {
    if (d.enclosingFnId) reachingKeys.add(`${d.file}::${d.enclosingFnId}`);
  }
  const threadsHit: Array<{ entryPointId: string; qualifiedName: string }> = [];
  const seenThread = new Set<string>();
  for (const t of threads) {
    if (!t.nodes.some((n) => n.irNodeId && reachingKeys.has(`${n.file}::${n.irNodeId}`))) continue;
    const key = t.entryPointId || t.qualifiedName;
    if (seenThread.has(key)) continue;
    seenThread.add(key);
    threadsHit.push({ entryPointId: t.entryPointId, qualifiedName: t.qualifiedName });
  }

  // Honest blind spot: dynamic/unresolved terminals whose name matches N.
  const name = targetNode?.name;
  const possibleHiddenCallers: HiddenCallerSuspect[] = [];
  if (name) {
    for (const t of threads) {
      for (const n of t.nodes) {
        if ((n.kind === "dynamic" || n.kind === "unresolved") && lastIdent(n.label) === name) {
          possibleHiddenCallers.push({
            threadNodeId: n.irNodeId ?? n.label,
            label: n.label,
            kind: n.kind,
            inThread: t.qualifiedName,
          });
        }
      }
    }
  }

  return {
    target: { nodeId: targetNodeId, file: targetFile, name: targetNode?.name, type: targetNode?.type },
    dependents,
    threads: threadsHit,
    possibleHiddenCallers,
    totals: {
      dependents: dependents.length,
      threads: threadsHit.length,
      possibleHiddenCallers: possibleHiddenCallers.length,
    },
    notes: [
      "dependents are STATICALLY-LINKED callers only (reference edges). A caller that reaches the target through a dynamic dispatch (getattr / a runtime-bound receiver) or an unresolved name emits NO edge and is NOT in this list.",
      "possibleHiddenCallers are name-matched dynamic/unresolved terminals — a heuristic, UNVERIFIED: the linker could not prove they reach the target. Confirm before trusting.",
      "threads names the entry-point flows AFFECTED if you edit the target — those that reach it directly or through one of its direct callers.",
    ],
  };
}
