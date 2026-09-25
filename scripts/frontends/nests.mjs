// M-CONTRACT.1 — nested-call honesty for the tree-sitter frontends, the
// M-NEST Layer 1 contract parse_cst.py already keeps: a call buried in
// another call's arguments must either be MINTED as a `nested` call node
// (direct call-valued args, recursively) or FLAGGED on the outer node
// (`nestsInnerCalls` without `nestExtracted`) — never silently dropped.
//
// Found by the polyglot fixture (2026-09-06): `EXPECT_DOUBLE_EQ(
// line_total(item), 6.0)` in a gtest lost `line_total` entirely — the
// thread read "statically complete" while hiding the one call the test
// exists to make. Same class in TS (`fetch(url, {body: JSON.stringify(x)})`)
// and bash (`echo "$(date)"`).
//
// Third concrete consumer (bash / jsts / cpp), so the tree-walking half
// lives here; each builder mints its own node shape because callee
// text, effect tables, and id grammar are per language.

/** Every node whose type is in `types` strictly BELOW `root`, in source
 *  order. Does NOT descend into a match (a nested call's own nests are the
 *  recursion's job — python's _emit_nested_call shape). */
export function topLevelDescendants(root, types) {
  const out = [];
  const stack = [...(root?.namedChildren ?? [])].reverse();
  while (stack.length) {
    const n = stack.pop();
    if (types.has(n.type)) { out.push(n); continue; }
    for (let i = n.namedChildren.length - 1; i >= 0; i--) stack.push(n.namedChildren[i]);
  }
  return out;
}

/** DETECTOR (python: _expr_has_nested_call) — `valueNode` hides a call
 *  the outer node would mask: any call node strictly below the outermost
 *  one (arg-nests, chains, literal-embedded calls — every form). */
export function hasNestedCall(valueNode, callTypes) {
  return !!valueNode && topLevelDescendants(valueNode, callTypes).length > 0;
}

/** EXTRACTION targets (python: _extract_arg_nests) — the DIRECT
 *  call-valued arguments of `callNode` after `unwrap` (await / parens),
 *  the v1 scope: calls buried in object literals, binops, or chains are
 *  detected-but-not-extracted. `argsField` names the grammar's argument
 *  list field ("arguments" for call_expression). */
export function directCallArgs(callNode, callTypes, unwrap = (n) => n, argsField = "arguments") {
  const args = callNode.childForFieldName(argsField);
  const out = [];
  for (const a of args?.namedChildren ?? []) {
    const v = unwrap(a);
    if (v && callTypes.has(v.type)) out.push(v);
  }
  return out;
}
