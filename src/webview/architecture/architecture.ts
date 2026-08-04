// Architecture derivation (A1) — a pure lens over the existing per-file IR,
// the PyTorch analogue of system/threadInteraction.ts. NO IR/schema change:
// reads facts the parser already emits (class `bases`, `self.X = layer(...)`
// assignments with `callTarget`, the ordered forward() body).
//
// A model is an `nn.Module` subclass: layers are the call-valued `self.<attr>`
// assignments in __init__; the data path is the order those layers are applied
// in forward(). We show code-truth and are honest where the code is dynamic —
// we never fabricate a runtime graph.
//
// Known limitation (locked decision, deferred): the IR drops nested/composed
// calls, so a forward written `x = F.relu(self.conv1(x))` exposes only the
// OUTERMOST call (F.relu). Layers referenced only inside a composed expression
// won't appear in forwardOrder and are reported as declared-but-unused rather
// than silently reordered.

import type { AstNode, ProjectFileData } from "../types";
import { layerVisual } from "./layer_visual";
import { paramCountFor } from "./layer_params";

export interface ArchLayer {
  /** attribute name with `self.` stripped, e.g. "conv1". */
  name: string;
  /** layer class, the last segment of callTarget, e.g. "Conv2d". */
  type: string;
  /** full dotted callee, e.g. "nn.Conv2d". */
  callTarget: string;
  /** truncated source preview of the constructor call. */
  argsPreview: string;
  /** positional constructor arg source strings (IR `args`). */
  args: string[];
  irNodeId: string;
  /** 1-based source line of the declaration (for net-type evidence refs). */
  line: number;
  /** true if applied in forward() (as an outermost call). */
  usedInForward: boolean;
  /** trainable parameter count, computed ONLY from literal args; undefined
      when args are non-literal or the layer type has no known formula. */
  paramCount?: number;
  /** Container expansion (sitting-3) — pre-flatten: the members minted from
      the M-NEST nested call nodes inside a Sequential(...)/ModuleList(...)
      declaration, in positional order. Present only on the container entry
      while ordering; deriveModels flattens members into the stack. */
  members?: ArchLayer[];
  /** Set on a flattened MEMBER: which container attribute it came from and
      that container's type — lets consumers (the forward-thread subtitle
      enrichment) regroup the chain under its `self.<attr>` call. */
  container?: { attr: string; type: string };
}

// Net-type classification — heuristic, confidence-honest (R3/R4 family).
// Reuses the system-tier honesty triple {confidence, evidence, refs}; the
// renderer recesses low confidence and the copy says "looks like", never a
// bare confident claim. A mix is reported as a mix, never collapsed.
export type NetTypeLabel =
  | "convolutional" | "recurrent" | "transformer" | "mlp" | "hybrid" | "unknown";

export interface NetTypeClass {
  label: NetTypeLabel;
  /** short display token, e.g. "CNN", "Conv + Attention". */
  display: string;
  confidence: "high" | "low";
  /** which layer types drove it, e.g. "2× Conv2d · 1× MultiheadAttention". */
  evidence: string;
  /** "<file>:<line>" of the driving layers. */
  refs: string[];
}

export interface ArchModel {
  className: string;
  file: string;
  classNodeId: string;
  isModel: boolean;
  /** evidence string for the recognizer (which base / transitive match). */
  recognizedBy: string;
  /** layers in forward-application order, then declared-but-unused. */
  layers: ArchLayer[];
  hasForward: boolean;
  /** IR node id of the forward() method, for seeding its data-path thread. */
  forwardNodeId: string | null;
  /** forward() contains control flow (if/for/while/try). The linear schematic
      can't honestly represent the branched data path — surface it and point to
      the forward thread (which renders the arms) instead of faking a stack. */
  forwardHasControlFlow: boolean;
  /** M-FS9 (full-scope review P3) — how the layer order was derived.
      "forward": every layer's position comes from its outermost call in
      forward(). "declaration"/"partial": composed one-liners
      (pool(relu(conv1(x)))) hide nested calls from the IR, so some or
      all layers ride in declaration order — which can visually REVERSE
      the real data path (pool drawn above conv1). The view must cue it. */
  orderDerivation: "forward" | "partial" | "declaration";
  netType: NetTypeClass;
}

// Control-flow node types (incl. the v1.5 container kinds the TS AstNodeType
// union doesn't yet list — matched as runtime strings).
const CONTROL_FLOW_TYPES = new Set([
  "if_stmt", "for_loop", "while_loop", "try_stmt", "except_handler", "finally_block",
]);

// The discriminating "signature" families. linear / norm / dropout /
// activation / pool / etc. are connective tissue — they don't establish an
// architecture, so they never dilute the signal (Ben's honesty-gate ruling).
type SignatureFamily = "conv" | "recurrent" | "attention";
const SIGNATURE: readonly SignatureFamily[] = ["conv", "recurrent", "attention"];

// Component name (what the LAYER is) vs architecture word (what a body of it
// IS). Even mixes name components honestly ("Conv + Attention"); a dominated
// mix earns the architecture word for its body ("conv stem + transformer
// body").
const COMPONENT: Record<SignatureFamily, string> = { conv: "Conv", recurrent: "Recurrent", attention: "Attention" };
const ARCH_WORD: Record<SignatureFamily, string> = { conv: "conv", recurrent: "recurrent", attention: "transformer" };
const SINGLE: Record<SignatureFamily, { label: NetTypeLabel; display: string }> = {
  conv: { label: "convolutional", display: "CNN" },
  recurrent: { label: "recurrent", display: "RNN" },
  attention: { label: "transformer", display: "Transformer" },
};

/**
 * Heuristic net-type classification, dominance-aware over the signature
 * families (conv/recurrent/attention). Honesty rules (honesty-gate ruling):
 *  - One signature family → that type (connective tissue ignored).
 *  - Two+ signature families → MIXED, high confidence (mixed ≠ uncertain):
 *    a clear dominant earns its architecture word + the minor as a "stem"
 *    ("conv stem + transformer body", labelled by the dominant); an even
 *    split names components ("Conv + Attention", labelled hybrid).
 *  - No signature family but Linear present → MLP.
 *  - Nothing recognizable → unknown at LOW confidence (genuine uncertainty).
 * Dominance is layer-count-based now; switch to param-weighted when A2's
 * structured args / param counts land (not a blocker).
 */
export function classifyNetType(layers: ArchLayer[], file: string): NetTypeClass {
  const famOf = (l: ArchLayer) => layerVisual(l.type).category as string;
  // signature-family layer counts + first-forward-appearance order.
  const counts = new Map<SignatureFamily, number>();
  const order: SignatureFamily[] = [];
  for (const l of layers) {
    const c = famOf(l);
    if ((SIGNATURE as readonly string[]).includes(c)) {
      const f = c as SignatureFamily;
      counts.set(f, (counts.get(f) ?? 0) + 1);
      if (!order.includes(f)) order.push(f);
    }
  }
  const hasLinear = layers.some((l) => famOf(l) === "linear");

  const driving = layers.filter((l) =>
    counts.size > 0 ? (SIGNATURE as readonly string[]).includes(famOf(l)) : famOf(l) === "linear",
  );
  const byType = new Map<string, number>();
  for (const l of driving) byType.set(l.type, (byType.get(l.type) ?? 0) + 1);
  const evidence = [...byType.entries()].map(([t, n]) => `${n}× ${t}`).join(" · ") || "no recognizable layers";
  const refs = driving.map((l) => `${file}:${l.line}`);

  // No signature family.
  if (counts.size === 0) {
    if (hasLinear) return { label: "mlp", display: "MLP", confidence: "high", evidence, refs };
    return { label: "unknown", display: "Unknown", confidence: "low", evidence, refs };
  }

  // Single signature family → that architecture.
  if (counts.size === 1) {
    const f = order[0];
    return { ...SINGLE[f], confidence: "high", evidence, refs };
  }

  // Mixed — high confidence (a clearly-mixed net is mixed, not uncertain).
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [domFam, domCount] = ranked[0];
  const restCount = ranked.slice(1).reduce((s, [, n]) => s + n, 0);
  if (domCount > restCount) {
    // Clear dominant body + minor stem(s), in forward order.
    const minors = order.filter((f) => f !== domFam);
    const display = `${minors.map((f) => ARCH_WORD[f]).join(" + ")} stem + ${ARCH_WORD[domFam]} body`;
    return { label: SINGLE[domFam].label, display, confidence: "high", evidence, refs };
  }
  // Even split — name the components, don't claim a higher architecture.
  const display = order.map((f) => COMPONENT[f]).join(" + ");
  return { label: "hybrid", display, confidence: "high", evidence, refs };
}

// A base that means "this is an nn.Module": matches `nn.Module`,
// `torch.nn.Module`, or a bare `Module` import. Heuristic + honest — the
// recognizer is string-based, not import-resolved.
const MODULE_BASE = /(?:^|\.)Module$/;

function lastSegment(dotted: string): string {
  const i = dotted.lastIndexOf(".");
  return i === -1 ? dotted : dotted.slice(i + 1);
}

function stripSelf(name: string): string {
  return name.startsWith("self.") ? name.slice(5) : name;
}

// All descendants of a node id (recursive), via parentId — so forward-body
// statements nested inside containers (an `if` arm) are still collected.
function descendantsOf(rootId: string, nodes: AstNode[]): AstNode[] {
  const childrenOf = new Map<string, AstNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push(n);
  }
  const out: AstNode[] = [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    const kids = childrenOf.get(n.id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/**
 * Derive every nn.Module model in the project from the per-file IR.
 * Pure: same input → same output, no side effects.
 */
export function deriveModels(
  projectIR: Record<string, ProjectFileData>,
): ArchModel[] {
  // First pass: every class with its bases, so the recognizer can resolve a
  // transitive subclass (a class whose base is another local model class).
  interface ClassInfo {
    node: AstNode;
    file: string;
    nodes: AstNode[];
    bases: string[];
  }
  const classes: ClassInfo[] = [];
  for (const [file, data] of Object.entries(projectIR)) {
    for (const n of data.nodes) {
      if (n.type === "class_def") {
        classes.push({ node: n, file, nodes: data.nodes, bases: n.bases ?? [] });
      }
    }
  }
  const classByName = new Map<string, ClassInfo>();
  for (const c of classes) if (c.node.name) classByName.set(c.node.name, c);

  // Recognizer: direct nn.Module base, or transitively via another local
  // model class. Cycle-safe; returns the evidence base name.
  const recogCache = new Map<string, { isModel: boolean; via: string }>();
  function recognize(c: ClassInfo, seen: Set<string>): { isModel: boolean; via: string } {
    const cached = recogCache.get(c.node.id);
    if (cached) return cached;
    if (seen.has(c.node.id)) return { isModel: false, via: "" };
    seen.add(c.node.id);
    let result = { isModel: false, via: "" };
    for (const b of c.bases) {
      if (MODULE_BASE.test(b)) {
        result = { isModel: true, via: `subclass of ${b}` };
        break;
      }
    }
    if (!result.isModel) {
      // transitive: a base that names another local model class.
      for (const b of c.bases) {
        const parent = classByName.get(lastSegment(b));
        if (parent && parent.node.id !== c.node.id) {
          const r = recognize(parent, seen);
          if (r.isModel) {
            result = { isModel: true, via: `subclass of ${b} (a model)` };
            break;
          }
        }
      }
    }
    recogCache.set(c.node.id, result);
    return result;
  }

  const models: ArchModel[] = [];
  for (const c of classes) {
    const { isModel, via } = recognize(c, new Set());
    if (!isModel) continue;

    // __init__ layer declarations: call-valued `self.<attr> = ...` assignments
    // parented to the class's __init__ method, in source order.
    const methods = c.nodes.filter(
      (n) => n.type === "function_def" && n.parentId === c.node.id,
    );
    const initFn = methods.find((m) => m.name === "__init__");
    const forwardFn = methods.find((m) => m.name === "forward");

    const declared: ArchLayer[] = [];
    if (initFn) {
      const initKids = c.nodes
        .filter((n) => n.parentId === initFn.id && n.type === "assignment")
        .sort((a, b) => a.line - b.line);
      for (const a of initKids) {
        if (a.valueKind !== "call" || !a.callTarget || !a.name?.startsWith("self.")) continue;
        const type = lastSegment(a.callTarget);
        const args = a.args ?? [];
        const attr = stripSelf(a.name);
        // Container expansion (sitting-3): a Sequential/ModuleList declared
        // in ONE assignment hid its members from the stack ("1 layers",
        // "? Unknown", params invisible). The M-NEST arg-walk already minted
        // each member as a nested call node parented to this assignment —
        // real IR, positional order — and for nn.Sequential positional order
        // IS application order (its contract), so expanding adds no runtime
        // guess. A container with no minted members (nn.Sequential(*layers),
        // dict-literal ModuleDict) stays a single collapsed card, honestly.
        let members: ArchLayer[] | undefined;
        if (layerVisual(type).category === "container") {
          const minted = c.nodes
            .filter((n) => n.parentId === a.id && n.type === "call" && n.nested && n.callTarget)
            .sort((x, y) => x.line - y.line || x.col - y.col);
          if (minted.length > 0) {
            members = minted.map((n, i) => {
              const mType = lastSegment(n.callTarget!);
              const mArgs = n.args ?? [];
              return {
                name: `${attr}[${i}]`, // net[0] — valid Python indexing into the container
                type: mType,
                callTarget: n.callTarget!,
                argsPreview: n.preview ?? n.callTarget!,
                args: mArgs,
                irNodeId: n.id,
                line: n.line,
                usedInForward: false,
                paramCount: paramCountFor(mType, mArgs),
                container: { attr, type },
              };
            });
          }
        }
        declared.push({
          name: attr,
          type,
          callTarget: a.callTarget,
          argsPreview: a.preview ?? a.callTarget,
          args,
          irNodeId: a.id,
          line: a.line,
          usedInForward: false,
          paramCount: paramCountFor(type, args),
          ...(members ? { members } : {}),
        });
      }
    }

    // forward order: layer names in first-appearance order among the
    // outermost `self.<attr>(...)` calls in forward().
    const byName = new Map(declared.map((l) => [l.name, l]));
    const forwardSeq: string[] = [];
    const captureLines: number[] = [];
    let forwardHasControlFlow = false;
    if (forwardFn) {
      const fwdDesc = descendantsOf(forwardFn.id, c.nodes);
      forwardHasControlFlow = fwdDesc.some((n) => CONTROL_FLOW_TYPES.has(n.type));
      const body = fwdDesc
        .filter((n) => n.callTarget) // assignment-with-call or call nodes
        .sort((a, b) => a.line - b.line);
      for (const n of body) {
        const attr = n.callTarget!.startsWith("self.") ? stripSelf(n.callTarget!) : null;
        if (attr && byName.has(attr) && !forwardSeq.includes(attr)) {
          forwardSeq.push(attr);
          byName.get(attr)!.usedInForward = true;
          captureLines.push(n.line);
        }
      }
    }

    // Order layers by forward application, then declared-but-unused after.
    const preFlatten: ArchLayer[] = [];
    for (const name of forwardSeq) preFlatten.push(byName.get(name)!);
    for (const l of declared) if (!l.usedInForward) preFlatten.push(l);

    // Flatten expanded containers into the stack in place of their card —
    // members inherit the container's forward-use (calling self.net(x)
    // applies every member).
    const ordered: ArchLayer[] = preFlatten.flatMap((l) =>
      l.members?.length
        ? l.members.map((m) => ({ ...m, usedInForward: l.usedInForward }))
        : [l],
    );

    // M-GF (greenfield review): TWO layers captured from the SAME line are
    // a nested chain (pool(relu(conv1(x)))) — nest extraction sees them in
    // source-text order, which is the REVERSE of application order. "All
    // layers used in forward" is not enough to trust the order.
    const multiPerLine = captureLines.some((l, i) => captureLines.indexOf(l) !== i);
    const orderDerivation: ArchModel["orderDerivation"] =
      declared.length === 0 || (declared.every((l) => l.usedInForward) && !multiPerLine)
        ? "forward"
        : forwardSeq.length === 0
          ? "declaration"
          : "partial";

    models.push({
      className: c.node.name ?? "(anonymous)",
      file: c.file,
      classNodeId: c.node.id,
      isModel: true,
      recognizedBy: via,
      layers: ordered,
      hasForward: !!forwardFn,
      forwardNodeId: forwardFn?.id ?? null,
      forwardHasControlFlow,
      orderDerivation,
      netType: classifyNetType(ordered, c.file),
    });
  }

  return models;
}
