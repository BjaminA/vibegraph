// M-CHAT-POLISH.3 — minimal markdown parser for chat + skill bodies.
//
// Hand-rolled on purpose (no dependency): the repo renders exactly the
// constructs Claude's replies and skill.md files actually use —
// ## / ### headings, - bullets, fenced code blocks, paragraphs, and
// inline `code` / **bold** / *italic*. Nothing else (no links, tables,
// images, nesting). The component half lives in Markdown.tsx; this
// half is pure so node:test can pin it.
//
// STREAMING TOLERANCE is a hard requirement: assistant text re-parses
// per chunk, so partial constructs must render stably —
//   * an unclosed ``` fence is an OPEN code block (open: true);
//   * a dangling ** or ` renders as literal text (it becomes emphasis
//     only once the closing marker arrives — never toggles before).

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 2 | 3; children: Inline[] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "codeblock"; text: string; lang: string; open: boolean }
  | { kind: "paragraph"; children: Inline[] };

// Bold first (its marker is longer); italic requires a non-space,
// non-* opener so bare asterisks in prose ("5 * 3") stay literal.
const BOLD_RE = /\*\*([^*]+?)\*\*/;
const ITALIC_RE = /\*([^\s*][^*\n]*?)\*/;

function parseEmphasis(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const b = BOLD_RE.exec(rest);
    const i = ITALIC_RE.exec(rest);
    const pick = b && (!i || b.index <= i.index)
      ? { m: b, kind: "bold" as const }
      : i
        ? { m: i, kind: "italic" as const }
        : null;
    if (!pick) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (pick.m.index > 0) out.push({ kind: "text", text: rest.slice(0, pick.m.index) });
    out.push({ kind: pick.kind, children: parseEmphasis(pick.m[1]) });
    rest = rest.slice(pick.m.index + pick.m[0].length);
  }
  return out;
}

/** Inline pass: `code` spans first (their contents are protected from
 * emphasis), then bold/italic over the remaining stretches. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = /`([^`\n]+)`/.exec(rest);
    if (!m) {
      out.push(...parseEmphasis(rest));
      break;
    }
    if (m.index > 0) out.push(...parseEmphasis(rest.slice(0, m.index)));
    out.push({ kind: "code", text: m[1] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let bullets: Inline[][] | null = null;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", children: parseInline(para.join("\n")) });
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      flushBullets();
      const body: string[] = [];
      let closed = false;
      while (++i < lines.length) {
        if (/^```\s*$/.test(lines[i])) { closed = true; break; }
        body.push(lines[i]);
      }
      blocks.push({ kind: "codeblock", text: body.join("\n"), lang: fence[1] ?? "", open: !closed });
      continue;
    }
    const heading = /^(##|###)\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushBullets();
      blocks.push({
        kind: "heading",
        level: heading[1] === "##" ? 2 : 3,
        children: parseInline(heading[2]),
      });
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      (bullets ??= []).push(parseInline(bullet[1]));
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushBullets();
      continue;
    }
    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();
  return blocks;
}
