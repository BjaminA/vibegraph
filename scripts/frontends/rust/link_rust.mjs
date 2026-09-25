#!/usr/bin/env node
// M-RUST (PLAN-M-RUST.md §6) — the Rust cross-file linker. Speaks
// cross_file_link.py's stdin/stdout contract over RUST per-file IRs.
// IDEMPOTENT.
//
// Resolution follows CARGO CONVENTION, which is how a person navigates a
// crate and — unlike C++'s header convention — is deterministic:
//
//   1. Every file knows its own place in the module tree, because the
//      PARSER read the manifest above it (ir.crateName / ir.cratePath /
//      ir.crateRoot). Nothing here guesses which crate a path names.
//   2. `mod x;` in a file at `crate::a` resolves to `<dir>/x.rs` or
//      `<dir>/x/mod.rs`. A crate ROOT's `mod x;` resolves under src/.
//   3. `use crate::a::b::Name` → the file whose cratePath is `crate::a::b`,
//      symbol `Name`. `super::` walks one module up, `self::` stays.
//      `use <crateName>::…` (a bin or an integration test reaching into
//      the lib) resolves the same way — that is what crateName is for.
//      `std` / `core` / `alloc` and every other root are EXTERNAL and
//      never link.
//   4. CALLS. Rust has no overloading, so a path call names exactly one
//      function and may be taken:
//        * `Type::method(..)` → that method, in the file defining Type;
//        * bare `f(..)`       → a top-level `f` here, else the file a
//                               `use` binds `f` from;
//        * `module::f(..)`    → `f` in the file that module names.
//      A METHOD call (`x.f()`) never links — picking its definition needs
//      the receiver's type, which no single file states, so it stays a
//      runtime question (`dynamic` downstream). A TURBOFISH call never
//      links (compile-time dispatch, the C++ template rule).

const EXTERNAL_ROOTS = new Set(["std", "core", "alloc"]);

function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function joinRel(dir, rest) {
  const parts = [];
  for (const seg of `${dir ? `${dir}/` : ""}${rest}`.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join("/");
}

/** Strip a turbofish so `parse::<i64>` keys as `parse`. */
function withoutTurbofish(callee) {
  return callee.replace(/::<[^>]*>/g, "");
}

export function linkFiles(files) {
  const rustFiles = Object.entries(files).filter(([, ir]) => ir?.language === "rust");
  if (!rustFiles.length) return files;

  // ── the crate's module tree ───────────────────────────────────────
  // cratePath → file, for every non-root file. Roots are excluded on
  // purpose: `crate` names the lib root for `use crate::…`, and that is
  // recorded separately, because a bin and the lib BOTH claim "crate"
  // while only the lib is what another crate's `use` can reach.
  const byCratePath = new Map();
  let libRoot = null;
  const crateNames = new Set();
  for (const [rel, ir] of rustFiles) {
    if (ir.crateName) crateNames.add(ir.crateName);
    if (typeof ir.cratePath !== "string") continue;
    if (ir.crateRoot) {
      if (rel.endsWith("src/lib.rs") || rel === "lib.rs") libRoot = rel;
      continue;
    }
    if (!byCratePath.has(ir.cratePath)) byCratePath.set(ir.cratePath, rel);
  }

  /** Definitions a file offers by name: top-level fns/types, and each
   *  type's methods keyed `Type::method`. */
  const defsOf = new Map();
  for (const [rel, ir] of rustFiles) {
    const m = new Map();
    const classIds = new Map();
    for (const n of ir.nodes ?? []) {
      if (n.type === "class_def" && n.parentId === null) {
        classIds.set(n.id, n.name);
        const cur = m.get(n.name);
        if (cur) cur.count += 1; else m.set(n.name, { id: n.id, count: 1 });
      }
    }
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def") continue;
      if (n.parentId === null) {
        const cur = m.get(n.name);
        if (cur) cur.count += 1; else m.set(n.name, { id: n.id, count: 1 });
      } else if (classIds.has(n.parentId)) {
        const key = `${classIds.get(n.parentId)}::${n.name}`;
        const cur = m.get(key);
        if (cur) cur.count += 1; else m.set(key, { id: n.id, count: 1 });
      }
    }
    defsOf.set(rel, m);
  }

  for (const [rel, ir] of rustFiles) {
    const nodes = ir.nodes ?? [];
    const edges = ir.edges ?? [];
    const myPath = typeof ir.cratePath === "string" ? ir.cratePath : null;
    const myDir = dirOf(rel);

    /** `crate::a::b` → the file holding it, following this crate's tree. */
    const fileForModulePath = (modPath) => {
      if (modPath === "crate") return libRoot;
      return byCratePath.get(modPath) ?? null;
    };

    /**
     * Rewrite a `use` path's ROOT into this crate's own spelling, or
     * return null when the path leaves the crate. `self`/`super` are
     * relative to THIS file's module path; `crate` and the crate's own
     * name are absolute.
     */
    const toCratePath = (modulePath) => {
      const segs = modulePath.split("::").filter(Boolean);
      if (!segs.length) return null;
      const head = segs[0];
      if (EXTERNAL_ROOTS.has(head)) return null;
      if (head === "crate") return ["crate", ...segs.slice(1)].join("::");
      if (crateNames.has(head)) return ["crate", ...segs.slice(1)].join("::");
      if (head === "self") {
        if (!myPath) return null;
        return [myPath, ...segs.slice(1)].join("::");
      }
      if (head === "super") {
        if (!myPath) return null;
        const up = myPath.split("::");
        up.pop();
        if (!up.length) return null;
        return [...up, ...segs.slice(1)].join("::");
      }
      return null; // another crate — external, and never guessed at
    };

    // ── 2. `mod x;` → the file it names ───────────────────────────────
    // Also the first half of import binding: a `mod` makes `x::f` mean
    // that file's `f`.
    const moduleFiles = new Map(); // local module name → file
    for (const n of nodes) {
      if (n.type !== "import") continue;
      const name = n.names?.[0];
      if (!name) continue;
      const base = ir.crateRoot ? (myDir ? `${myDir}` : "") : myDir;
      // A root's modules live beside it; a non-root's live in a directory
      // named after it (src/a.rs owns src/a/b.rs).
      const ownDir = ir.crateRoot
        ? base
        : joinRel(base, rel.slice(base ? base.length + 1 : 0).replace(/\.rs$/, ""));
      const candidates = [
        joinRel(ownDir, `${name}.rs`),
        joinRel(ownDir, `${name}/mod.rs`),
      ];
      const target = candidates.find((c) => c in files);
      if (!target) continue;
      moduleFiles.set(name, target);
      const first = (files[target].nodes ?? [])[0];
      if (!first) continue;
      if (edges.some((e) => e.source === n.id && e.type === "reference")) continue;
      edges.push({
        source: n.id,
        target: first.id,
        type: "reference",
        targetFile: target,
        qualifiedTarget: `${files[target].modulePath ?? target}:module`,
      });
    }

    // ── 3. `use` → what each imported NAME resolves to ────────────────
    // name → {file, symbol}. This is what makes a bare call into an
    // imported function link, and what the stack index reads to tell a
    // project import from a dependency.
    const useBindings = new Map();
    const useModules = new Map(); // local alias → module path (for `a::f`)
    for (const n of nodes) {
      if (n.type !== "import_from") continue;
      const modulePath = typeof n.module === "string" ? n.module : "";
      const cratePath = toCratePath(modulePath);
      if (!cratePath) continue; // external (std / another crate) — not ours
      for (const rawName of n.names ?? []) {
        const [leaf, alias] = rawName.split(" as ").map((x) => x.trim());
        const bound = alias || leaf;
        if (leaf === "*") {
          const f = fileForModulePath(cratePath);
          if (f) useModules.set("*", cratePath);
          continue;
        }
        // `use crate::a::b` can name a MODULE (then `b::f` is a call) or
        // an ITEM in module `crate::a`. Both are checked, module first.
        const asModule = fileForModulePath(`${cratePath}::${leaf}`);
        if (asModule) { useModules.set(bound, `${cratePath}::${leaf}`); continue; }
        const inModule = fileForModulePath(cratePath);
        if (inModule) useBindings.set(bound, { file: inModule, symbol: leaf });
      }
    }

    // ── 4. calls ──────────────────────────────────────────────────────
    const hasRef = new Set(edges.filter((e) => e.type === "reference").map((e) => e.source));
    const callShapes = [];
    for (const n of nodes) {
      const callee = n.type === "call"
        ? (n.funcName ?? n.callTarget)
        : ((n.type === "assignment" || n.type === "return_stmt" || n.type === "raise_stmt")
          ? n.callTarget : null);
      if (typeof callee === "string" && callee) callShapes.push({ id: n.id, callee });
    }

    const localDefs = defsOf.get(rel);

    /** Where a callee may be found, strongest evidence first. Returns
     *  {file, key} or null — never a guess. */
    const resolveCallee = (rawCallee) => {
      const callee = withoutTurbofish(rawCallee);
      // A method call carries a receiver; its type is not stated here.
      if (callee.includes(".") || callee.includes("(") || callee.endsWith("!")) return null;
      // A turbofish was compile-time dispatch — refuse even stripped.
      if (rawCallee.includes("::<")) return null;
      const segs = callee.split("::").filter(Boolean);
      if (!segs.length) return null;

      if (segs.length === 1) {
        const name = segs[0];
        if (localDefs?.get(name)?.count === 1) return { file: rel, key: name };
        const bound = useBindings.get(name);
        if (bound && defsOf.get(bound.file)?.get(bound.symbol)?.count === 1) {
          return { file: bound.file, key: bound.symbol };
        }
        return null;
      }

      const owner = segs[segs.length - 2];
      const leaf = segs[segs.length - 1];

      // `Type::method` — the type may be defined here or imported.
      const typeKey = `${owner}::${leaf}`;
      if (localDefs?.get(typeKey)?.count === 1) return { file: rel, key: typeKey };
      const ownerBinding = useBindings.get(owner);
      if (ownerBinding) {
        const f = ownerBinding.file;
        if (defsOf.get(f)?.get(`${ownerBinding.symbol}::${leaf}`)?.count === 1) {
          return { file: f, key: `${ownerBinding.symbol}::${leaf}` };
        }
      }

      // `module::f` — a `mod` of this file, or a `use`d module.
      const viaMod = moduleFiles.get(owner);
      if (viaMod && defsOf.get(viaMod)?.get(leaf)?.count === 1) {
        return { file: viaMod, key: leaf };
      }
      const viaUse = useModules.get(owner);
      if (viaUse) {
        const f = fileForModulePath(viaUse);
        if (f && defsOf.get(f)?.get(leaf)?.count === 1) return { file: f, key: leaf };
        // `mod::Type::method` through an imported module.
        if (f && defsOf.get(f)?.get(typeKey)?.count === 1) return { file: f, key: typeKey };
      }

      // A fully spelled `crate::a::b::f` (or the crate's own name).
      const asPath = toCratePath(segs.slice(0, -1).join("::"));
      if (asPath) {
        const f = fileForModulePath(asPath);
        if (f && defsOf.get(f)?.get(leaf)?.count === 1) return { file: f, key: leaf };
      }
      const typePath = toCratePath(segs.slice(0, -2).join("::"));
      if (typePath) {
        const f = fileForModulePath(typePath);
        if (f && defsOf.get(f)?.get(typeKey)?.count === 1) return { file: f, key: typeKey };
      }
      return null;
    };

    for (const { id, callee } of callShapes) {
      if (hasRef.has(id)) continue; // same-file pass / idempotence
      const hit = resolveCallee(callee);
      if (!hit) continue;
      const def = defsOf.get(hit.file)?.get(hit.key);
      if (!def) continue;
      if (hit.file === rel) continue; // the parser already made same-file edges
      edges.push({
        source: id,
        target: def.id,
        type: "reference",
        targetFile: hit.file,
        qualifiedTarget: `${files[hit.file].modulePath ?? hit.file}:${hit.key}`,
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
