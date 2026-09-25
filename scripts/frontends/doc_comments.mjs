// M-LANG PARITY (PLAN-HISTORY: M-LANG arc follow-up) — the docstring
// analog for comment-based languages, shared by the bash / jsts / cpp
// builders (three consumers from day one).
//
// Python's `docstring` field is load-bearing well beyond display: it is
// the THREAD STEP PREVIEW (extract_thread paints fn.docstring on every
// step node), the entry-point summary discover shows in the launchpad,
// and what explain/chat/skills quote. The honest analog in the other
// languages is the CONTIGUOUS comment block immediately above a
// definition — a deliberate authored description, exactly like a
// docstring. Rules that keep it honest:
//
//   * contiguity: each comment line must end exactly one line above
//     the next (a blank line breaks the block — a distant comment is
//     NOT this function's doc);
//   * same indent column as the definition (a trailing comment on the
//     previous statement's line is not a doc block);
//   * shebangs are never docs.

/** The comment node type the bash / jsts / cpp grammars all share. Rust
 *  spells it `line_comment` / `block_comment`, so the type set is a
 *  PARAMETER rather than a constant — M-RUST is the first caller that
 *  needed it, and the default keeps the other three byte-identical. */
const DEFAULT_COMMENT_TYPES = new Set(["comment"]);

/** The last row a node's TEXT occupies.
 *
 *  A node that ends at column 0 ended by consuming its line terminator,
 *  so its text really stops on the row above — which is exactly what
 *  tree-sitter-rust's `line_comment` does and the other three grammars'
 *  `comment` does not. Reading the raw end row instead made every Rust
 *  doc comment look like it sat ON the item it documents, so the
 *  contiguity check rejected all of them and every docstring came back
 *  null. Deriving it keeps the other three byte-identical (their
 *  comments end mid-line, so there is nothing to adjust). */
function lastTextRow(node) {
  return node.endPosition.column === 0 ? node.endPosition.row - 1 : node.endPosition.row;
}

/** Contiguous same-column comment block directly above `anchor`, raw. */
export function commentBlockAbove(anchor, sourceText, types = DEFAULT_COMMENT_TYPES) {
  const lines = [];
  let sib = anchor.previousNamedSibling;
  let expectRow = anchor.startPosition.row - 1;
  while (
    sib
    && types.has(sib.type)
    && lastTextRow(sib) === expectRow
    && sib.startPosition.column === anchor.startPosition.column
  ) {
    const raw = sourceText.slice(sib.startIndex, sib.endIndex);
    if (raw.startsWith("#!")) break; // a shebang is never a doc
    lines.unshift(raw);
    expectRow = sib.startPosition.row - 1;
    sib = sib.previousNamedSibling;
  }
  return lines;
}

/** Strip #, //, /* * / and JSDoc gutters down to the prose. */
export function stripCommentMarkers(rawLines) {
  const joined = rawLines
    .map((raw) => {
      let t = raw.trim();
      if (t.startsWith("/*")) t = t.replace(/^\/\*+/, "");
      if (t.endsWith("*/")) t = t.replace(/\*+\/$/, "");
      return t
        .split("\n")
        // Rust doc comments are `///` (outer) and `//!` (inner, on a
        // module). The `//+` rule already eats the slashes; the `!` is
        // stripped here so a module doc does not read as prose that
        // begins with an exclamation mark.
        .map((l) => l.trim().replace(/^(#+|\/\/+!?|\*+)\s?/, "").trimEnd())
        .join("\n");
    })
    .join("\n")
    .trim();
  return joined || null;
}

/**
 * The docstring analog for `node`: prose of the contiguous comment
 * block above `anchor` (the outermost statement — pass the
 * export_statement / template_declaration wrapper when one exists, or
 * the node itself). Returns null when there is none — absence stays
 * honest, exactly like a Python function without a docstring.
 */
export function docFromComments(anchor, sourceText, types) {
  return stripCommentMarkers(commentBlockAbove(anchor, sourceText, types));
}
