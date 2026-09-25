#!/usr/bin/env node
// M-LANG5a (PLAN-M-LANG.md) — the C++ cross-file linker. Speaks
// cross_file_link.py's stdin/stdout contract over CPP per-file IRs.
// IDEMPOTENT. NO build graph: resolution follows the header
// convention, which is how humans navigate C++ without a compiler:
//
//   1. #include "x.h" resolves relative to the including file, then
//      the project root. System includes (<vector>) never link.
//   2. The link CANDIDATES for an include are the header itself (for
//      inline/template definitions) plus its COMPANION sources — same
//      directory + basename with .cpp/.cc/.cxx (NAMED CONVENTION
//      LIMIT: a definition living in an unrelated .cpp is not found;
//      that is compile_commands territory, deliberately out of v1).
//   3. OVERLOAD HONESTY: a bare callee links only when exactly ONE
//      definition of that name exists across THIS file + all
//      candidates. Two or more → NO edge, no guess — the call
//      classifies `unresolved` downstream (a resolution gap the
//      tooltip can honestly name). Qualified/member/template callees
//      never link here (the extractor's honesty rules own them).

function posixDir(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p) {
  const abs = p.startsWith("/");
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return (abs ? "/" : "") + parts.join("/");
}

const COMPANION_EXTS = [".cpp", ".cc", ".cxx"];

export function linkFiles(files) {
  // fnDefs: path → Map(name → {id, count}). Classes index too — a
  // constructor call (`Circle c(2.0)`) links to the class_def exactly
  // as the Python linker links instantiations to classes; the same
  // single-definition rule applies.
  const fnDefs = new Map();
  for (const [rel, ir] of Object.entries(files)) {
    const m = new Map();
    for (const n of ir.nodes ?? []) {
      // A definition named `Router::parse` USED to be excluded here, which
      // meant an out-of-line method definition — the ordinary way to write
      // C++ — could never be a link target. It is indexed under its own
      // qualified name now; the callee side below decides what may match it.
      const linkable = (n.type === "function_def" || n.type === "class_def") && n.parentId === null;
      if (linkable) {
        const cur = m.get(n.name);
        if (cur) cur.count += 1;
        else m.set(n.name, { id: n.id, count: 1 });
      }
    }
    fnDefs.set(rel, m);
  }

  // Every namespace any file in this project OPENS. A leading qualifier on
  // a call site may be dropped only when it names one of these: namespaces
  // flatten, so `net::verdict_name` has to reach a definition indexed as
  // `verdict_name`, but an unknown `other::parse` must NOT be allowed to
  // land on a same-named function it has nothing to do with.
  const projectNamespaces = new Set();
  for (const ir of Object.values(files)) {
    for (const ns of ir.namespaces ?? []) projectNamespaces.add(ns);
  }

  /**
   * The names a call site may legitimately be looked up under, in order of
   * decreasing confidence: the callee exactly as written, then the same
   * with leading PROJECT-NAMESPACE segments removed. Nothing else is
   * dropped — a class qualifier is part of the definition's own name and
   * must still match it.
   */
  const lookupNames = (callee) => {
    const out = [callee];
    const segs = callee.split("::");
    let i = 0;
    while (i < segs.length - 1 && projectNamespaces.has(segs[i])) {
      i += 1;
      out.push(segs.slice(i).join("::"));
    }
    return out;
  };

  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "cpp") continue; // frontend isolation
    const nodes = ir.nodes ?? [];
    const edges = ir.edges ?? [];

    // 1+2 — resolve quoted includes → candidate files (header + companions).
    const candidates = [];
    for (const n of nodes) {
      if (n.type !== "import") continue;
      const target = n.names?.[0] ?? "";
      if (!target || target.startsWith("<")) continue; // system include
      const dir = posixDir(rel);
      const headerPath = [normalize(dir ? `${dir}/${target}` : target), normalize(target)]
        .find((c) => c in files);
      if (!headerPath) continue;
      candidates.push(headerPath);
      const base = headerPath.replace(/\.[^./]+$/, "");
      for (const ext of COMPANION_EXTS) {
        const companion = base + ext;
        if (companion in files && companion !== rel) candidates.push(companion);
      }
    }

    const hasRef = new Set(edges.filter((e) => e.type === "reference").map((e) => e.source));
    const callShapes = [];
    for (const n of nodes) {
      if (n.type === "call" && n.funcName) callShapes.push({ id: n.id, callee: n.funcName });
      else if (n.type === "assignment" && n.valueKind === "call" && n.callTarget) {
        callShapes.push({ id: n.id, callee: n.callTarget });
      } else if (n.type === "return_stmt" && n.callTarget) {
        callShapes.push({ id: n.id, callee: n.callTarget });
      }
    }

    const localDefs = fnDefs.get(rel);
    for (const { id, callee } of callShapes) {
      if (hasRef.has(id)) continue; // same-file pass / idempotence
      // A MEMBER call (`router.route`, `it->second->deliver`) is a call on
      // an object, and picking its definition needs the receiver's type,
      // which this frontend does not infer — it stays a runtime question.
      // A TEMPLATE call keeps its `<T>` and stays dynamic by decision.
      // `::` no longer disqualifies: that is the whole fix.
      if (/[.<>-]/.test(callee)) continue;
      // 3 — overload honesty, now across every name this callee may be
      // looked up under. The FIRST name that matches anything decides:
      // an exact hit is never overridden by a less-qualified one.
      let hit = null, total = 0, usedName = callee;
      for (const name of lookupNames(callee)) {
        let t = localDefs?.get(name)?.count ?? 0;
        let h = null;
        for (const cand of candidates) {
          const def = fnDefs.get(cand)?.get(name);
          if (!def) continue;
          t += def.count;
          if (!h) h = { file: cand, id: def.id };
        }
        if (!h && !t) continue; // this spelling names nothing; try the next
        hit = h; total = t; usedName = name;
        break;
      }
      if (total !== 1 || !hit) continue; // 0 = genuine gap; 2+ = overload — no guessing
      edges.push({
        source: id,
        target: hit.id,
        type: "reference",
        targetFile: hit.file,
        qualifiedTarget: `${files[hit.file].modulePath ?? hit.file}:${usedName}`,
      });
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ files: linkFiles(files ?? {}) }));
}
