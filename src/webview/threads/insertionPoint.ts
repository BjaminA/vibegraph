// M12.3 — insertion-point inference for the Add-component drop flow.
//
// Pure function. No React, no DOM, no state. Given the drop's (kind,
// target_ir_type) pair, returns either a single resolved insertion
// point, an ambiguous set with a default, or a rejection if no legal
// point exists. The resolution table is PLAN-v3.md §3.2.
//
// The shape is deliberately data-driven so the InsertionPointPicker UI
// (M12.3) and the post-drop modal (M12.4) can both read the same
// answer, and so test/insertion_point.test.mjs can pin every (kind,
// target) cell in the table without spinning up a webview.

import type { AddKind } from "./useAddComponentDrag";

export type InsertionPoint =
  | "before"       // op_insert_before
  | "after"        // op_insert_after
  | "inside_top"   // op_insert_as_first_child
  | "inside_end";  // op_insert_as_last_child

export type ResolveResult =
  | { kind: "resolved"; point: InsertionPoint; reason: string }
  | { kind: "ambiguous"; options: InsertionPoint[]; defaultPoint: InsertionPoint; reason: string }
  | { kind: "rejected"; reason: string };

// IR node types that have a body we can insert into. Mirrors the
// `_BODY_BEARING_TYPES` set in scripts/cst_rewrite.py — keep them in
// sync. (parse_cst.py emits these as the `type` field on IR nodes.)
const BODY_BEARING_IR_TYPES = new Set<string>([
  "function_def",
  "class_def",
  "for_loop",
  "if_stmt",
  // while_loop: rewriter accepts it but parse_cst.py doesn't emit it
  // yet (see M12.1 commit message). Listed here so the UI is ready
  // when GraphBuilder gains visit_While; the rewrite still works.
  "while_loop",
]);

// Modules / top-level scope. Drops on the canvas background (not on a
// thread/diagram node) are treated as `target = "module"` so function
// and class additions land at file scope.
const MODULE_TARGET = "module";

// IR node types that are "non-body" — drops on these resolve to a
// picker because before / after / inside (where inside is its
// surrounding body) are all defensible. PLAN-v3 §3.2 rule 3.
function isNonBodyStatement(irType: string): boolean {
  return (
    irType === "call" ||
    irType === "assignment" ||
    irType === "return_stmt" ||
    irType === "raise_stmt" ||
    irType === "import" ||
    irType === "import_from"
  );
}

// Statement-kind add kinds (everything except `describe`, which routes
// through a different modal — see M12.5).
function isStatementKind(addKind: AddKind): boolean {
  return addKind !== "describe";
}

/**
 * Resolve where a dropped `addKind` should land relative to `targetIrType`.
 *
 * Returns:
 *   - `{ kind: "resolved", point, reason }` if a single insertion point
 *     is the obvious answer (no picker needed).
 *   - `{ kind: "ambiguous", options, defaultPoint, reason }` if the user
 *     should see the §4.1 floating picker; `defaultPoint` is what gets
 *     focused initially.
 *   - `{ kind: "rejected", reason }` if no legal point exists — the
 *     drop should be ignored, the drag should stay live, and the user
 *     can move to a different target.
 *
 * `targetIrType` follows parse_cst.py's `type` enumeration ("call",
 * "function_def", "class_def", "for_loop", "if_stmt", "return_stmt",
 * "raise_stmt", "import", "import_from", "assignment", "module"). The
 * special string "module" indicates a top-level drop (file scope).
 *
 * `hasExistingReturn` is consulted only for §3.2 rule 1 (return on
 * function_def). Pass `false` if you don't know — the resolver falls
 * back to `inside_end`, which is correct when there is no existing
 * return and matches PLAN-v3's behaviour-when-there-is-one (the
 * "before existing return" sub-case is wired in the CST op later).
 */
export function resolveInsertionPoint(
  addKind: AddKind,
  targetIrType: string,
  hasExistingReturn: boolean = false,
): ResolveResult {
  // The `describe` kind doesn't have an insertion-point story at this
  // layer — the Claude path (M12.5) returns its own (kind, point)
  // tuple. Treat as resolved-to-after as a sensible default so the
  // M12.3 flow can still log a payload; M12.5 will override.
  if (!isStatementKind(addKind)) {
    return {
      kind: "resolved",
      point: "after",
      reason: "describe kind defers insertion point to the Claude path (M12.5)",
    };
  }

  // §3.2 rule 5 — function_def / class_def are top-level entities.
  // They cannot land inside a call / assignment / return_stmt.
  if ((addKind === "function_def" || addKind === "class_def") &&
      isNonBodyStatement(targetIrType)) {
    return {
      kind: "rejected",
      reason: `${addKind} can't be inserted inside a ${targetIrType}; drop on a function_def, class_def, module, or other body-bearing target`,
    };
  }

  // §3.2 rule 5 — return_stmt only legal inside a function body.
  if (addKind === "return_stmt") {
    if (targetIrType === "function_def") {
      // §3.2 rule 1 — return goes at end of body. If a return already
      // exists there, the CST op's caller should switch to "before"
      // the existing return; the resolver surfaces this as ambiguous
      // so the picker offers the choice.
      if (hasExistingReturn) {
        return {
          kind: "ambiguous",
          options: ["inside_end", "before"],
          defaultPoint: "before",
          reason: "function already has a return; add the new logic before it, or replace the trailing return",
        };
      }
      return {
        kind: "resolved",
        point: "inside_end",
        reason: "return goes at the end of the function body",
      };
    }
    // return inside loops / conditionals is unusual but legal:
    // resolved as inside_end so the loop/if body still gets it.
    if (BODY_BEARING_IR_TYPES.has(targetIrType)) {
      return {
        kind: "resolved",
        point: "inside_end",
        reason: `return appended to the ${targetIrType} body`,
      };
    }
    return {
      kind: "rejected",
      reason: `return_stmt must drop on a function_def or body-bearing target; got ${targetIrType}`,
    };
  }

  // §3.2 rule 4 — function_def / class_def on module scope → append
  // to module body.
  if ((addKind === "function_def" || addKind === "class_def") &&
      targetIrType === MODULE_TARGET) {
    return {
      kind: "resolved",
      point: "inside_end",
      reason: `${addKind} appended at module scope`,
    };
  }

  // §3.2 rule 4 (extended) — function_def / class_def dropped on a
  // class_def → method/nested-class on that class's body.
  if (addKind === "function_def" && targetIrType === "class_def") {
    return {
      kind: "resolved",
      point: "inside_end",
      reason: "function appended as method on the class body",
    };
  }

  // §3.2 rule 2 — statement-kind dropped on a body-bearing target →
  // append to body. Modifier-key overrides (PLAN-v3 §4.2) handled at
  // the caller (App.tsx) before this function runs.
  if (BODY_BEARING_IR_TYPES.has(targetIrType)) {
    return {
      kind: "resolved",
      point: "inside_end",
      reason: `${addKind} appended to the ${targetIrType} body`,
    };
  }

  // §3.2 rule 3 — statement-kind dropped on a non-body target →
  // ambiguous. Default focus on "after" (most common intent: "do X,
  // then this new thing").
  if (isNonBodyStatement(targetIrType)) {
    return {
      kind: "ambiguous",
      options: ["before", "after"],
      defaultPoint: "after",
      reason: `${targetIrType} is a single statement; drop will land before or after it`,
    };
  }

  // Module-scope drop with a statement kind (not function/class — those
  // are rule 4 above). Append to module body.
  if (targetIrType === MODULE_TARGET) {
    return {
      kind: "resolved",
      point: "inside_end",
      reason: `${addKind} appended at module scope`,
    };
  }

  // Unknown target IR type — refuse rather than guess.
  return {
    kind: "rejected",
    reason: `no resolution rule for (kind=${addKind}, target=${targetIrType})`,
  };
}

/**
 * Apply a modifier-key override to an already-resolved point. Per
 * PLAN-v3 §4.2:
 *   - alt    → force ambiguous (show the picker regardless)
 *   - shift  → force "before"
 *   - ctrl / cmd → force "after"
 *
 * Returns a ResolveResult. If `alt` is set and the base resolution is
 * ambiguous, the ambiguous shape is preserved. If `alt` is set on a
 * resolved point, it's upgraded to ambiguous with that point as the
 * default. Force-before / force-after override the picker entirely.
 *
 * Note: shift / ctrl on a target that doesn't legally accept
 * before/after (e.g. shift+drop on a body-bearing target where rule 2
 * applies) still applies the override; legality is the CST op's call.
 * The webview surfaces what the user asked for.
 */
export function applyModifierOverride(
  base: ResolveResult,
  modifiers: { alt: boolean; shift: boolean; ctrl: boolean; meta: boolean },
): ResolveResult {
  if (base.kind === "rejected") {
    return base;
  }
  const { alt, shift, ctrl, meta } = modifiers;
  const cmd = ctrl || meta;

  if (shift) {
    return { kind: "resolved", point: "before", reason: "shift override → before" };
  }
  if (cmd) {
    return { kind: "resolved", point: "after", reason: "ctrl/cmd override → after" };
  }
  if (alt) {
    if (base.kind === "ambiguous") return base;
    return {
      kind: "ambiguous",
      options: ["before", "after", "inside_top", "inside_end"],
      defaultPoint: base.point,
      reason: "alt override → show picker",
    };
  }
  return base;
}
