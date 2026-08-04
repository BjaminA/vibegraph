// Pure layer parameter-count formulas for the Architecture view's param
// badges. Zero imports on purpose: it is unit-tested directly under Node's
// type-stripping (test/arch_param_count.test.mjs), which cannot pull the
// lucide-react chain the rest of the architecture module graph carries.
//
// The counts are computed ONLY from positional integer-literal constructor
// args — never guessed. When an arg is non-literal, or supplied by keyword
// (so the IR captures fewer positional args than a formula needs), the count
// is OMITTED (undefined), never approximated and never NaN.

// Parse a single arg to a positive int iff it is a pure integer literal.
// Names, expressions, and keyword forms (`kernel_size=3`) are NOT literal →
// null, so the param count is honestly omitted.
function literalInt(s: string | undefined): number | null {
  if (s == null) return null;
  return /^\d+$/.test(s.trim()) ? parseInt(s, 10) : null;
}

// Per-layer trainable-param count from literal positional args only. Returns
// undefined for unknown types or non-literal args (omitted in the UI). Bias
// terms assume the framework default (present).
export function paramCountFor(type: string, args: string[]): number | undefined {
  const ints = args.map(literalInt);
  // Require n POSITIONAL literal args actually present — a bare
  // `.slice(0, n).every()` passes vacuously when fewer than n args exist
  // (e.g. Conv2d(16, 32, kernel_size=3) where kernel_size is keyword and the
  // IR captures only positional args), leaving a formula variable undefined →
  // NaN. Honest: without the positional kernel size we cannot count, so omit.
  const need = (n: number) => ints.length >= n && ints.slice(0, n).every((v) => v !== null);
  if (type === "Linear" && need(2)) {
    const [i, o] = ints as number[];
    return i * o + o; // weight + bias
  }
  if (/^Conv[123]d$/.test(type) && need(3)) {
    const dim = parseInt(type.slice(4), 10); // Conv2d → 2
    const [ci, co, k] = ints as number[];
    return co * ci * Math.pow(k, dim) + co; // square/cubic kernel + bias
  }
  if (type === "Embedding" && need(2)) {
    const [num, d] = ints as number[];
    return num * d;
  }
  if (/^BatchNorm[123]d$/.test(type) && need(1)) {
    return 2 * (ints[0] as number); // weight + bias (affine)
  }
  if (type === "LayerNorm" && need(1)) {
    return 2 * (ints[0] as number);
  }
  return undefined;
}
