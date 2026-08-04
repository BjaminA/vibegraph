// Sitting-3 — array-like parameter detection for the run-to-here synth gate.
//
// Run-to-here synthesizes PLAUSIBLE PURE LITERALS (numbers, lists, dicts) for
// a function's required parameters (synth_args.ts). But a parameter the
// function uses as a TENSOR / ndarray / Series can't be a literal — the
// synth's list has no `.mean(dim=...)`, so the run crashed with an
// `AttributeError` *before* reaching the target node (the pump-lab
// `fit_standardizer(column)` symptom). This detector lets the synth gate
// DECLINE such a parameter HONESTLY up front — "run a real thread that feeds
// it real data" — instead of proposing a value doomed to crash.
//
// Pure + deterministic (lexical over the function source — never an LLM,
// never a guess). Deliberately biased for PRECISION: it flags only clearly
// array-only usage, so a false decline is unlikely. A miss simply falls back
// to today's behaviour (synth a list, crash honestly) — never worse.

// Array-only method names — none of these exist on a plain list / dict / str
// / number, so `<param>.<method>(` is strong evidence the param is a
// tensor / ndarray / DataFrame (all un-synthesizable as literals). pandas /
// numpy / torch all share these; flagging any of them is correct because the
// synth can produce none of them.
const ARRAY_METHODS = [
  "mean", "std", "var", "sum", "prod", "cumsum", "cumprod",
  "argmax", "argmin", "reshape", "view", "unsqueeze", "squeeze",
  "permute", "transpose", "matmul", "mm", "bmm", "dot",
  "softmax", "sigmoid", "flatten", "expand", "clamp", "norm",
  "numpy", "dim", "nelement", "element_size", "masked_fill",
  "gather", "scatter", "index_select",
].join("|");

// Array-only attributes (properties). `.shape` / `.dtype` / `.ndim` don't
// exist on plain builtins.
const ARRAY_ATTRS = ["shape", "dtype", "ndim", "device"].join("|");

// Array libraries: a param passed INTO one of these is being used as array
// data (`torch.where(...column...)`, `np.dot(a, column)`, `F.relu(x)`).
const ARRAY_LIBS = ["torch", "np", "numpy", "F", "nn", "pd"].join("|");

function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True iff `param` is used in a clearly array-only way somewhere in `src`. */
export function usesParamAsArray(src: string, param: string): boolean {
  if (!/^[A-Za-z_]\w*$/.test(param)) return false;
  const p = reEsc(param);
  const patterns = [
    // <param>.<array-method>(
    new RegExp(`\\b${p}\\.(?:${ARRAY_METHODS})\\s*\\(`),
    // <param>.<array-attr>
    new RegExp(`\\b${p}\\.(?:${ARRAY_ATTRS})\\b`),
    // (torch|np|F|nn|pd).<fn>( … <param> … )  — param passed to an array lib
    new RegExp(`\\b(?:${ARRAY_LIBS})\\.\\w+\\s*\\([^)]*\\b${p}\\b`),
    // <param> @ x   — matmul (param on the left can't be a decorator)
    new RegExp(`\\b${p}\\s*@\\s*[\\w(\\[]`),
  ];
  return patterns.some((re) => re.test(src));
}

/** Extract bare NAMES of the REQUIRED positional params from a def's param
 *  list (as the IR carries them, e.g. ["x", "column", 'path="d.csv"']).
 *  Drops defaults, self / cls, and *args / **kwargs — exactly the set the
 *  synth must produce a value for. */
export function requiredParamNames(params: string[] | undefined): string[] {
  return (params ?? [])
    .map((p) => p.trim())
    .filter((p) => p && !p.includes("=") && !p.startsWith("*") && p !== "self" && p !== "cls")
    .map((p) => {
      // Strip a bare annotation (`x: int`) down to the name.
      const colon = p.indexOf(":");
      return (colon >= 0 ? p.slice(0, colon) : p).trim();
    })
    .filter((p) => /^[A-Za-z_]\w*$/.test(p));
}

/** The required params of `fnSource` that are used as arrays — the ones the
 *  literal synth cannot honestly produce. Empty = nothing to decline. */
export function arraylikeParams(fnSource: string, params: string[] | undefined): string[] {
  return requiredParamNames(params).filter((p) => usesParamAsArray(fnSource, p));
}

/** The honest decline message for a run whose entry needs array-typed input. */
export function arraylikeDeclineReason(entryFn: string, flagged: string[]): string {
  const list = flagged.map((p) => `\`${p}\``).join(", ");
  const plural = flagged.length > 1;
  return (
    `Can't synthesize ${list} — ${entryFn} uses ${plural ? "them" : "it"} as a ` +
    `tensor/array (e.g. \`.mean(dim=…)\`), and run-to-here can only make plain ` +
    `literals (numbers, lists), never a \`torch.tensor(…)\`. Run a real thread ` +
    `that feeds ${entryFn} real data (its callers reach this node with a genuine ` +
    `tensor), or start from an entry point that builds the input.`
  );
}
