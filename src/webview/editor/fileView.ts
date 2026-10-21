// One file, several views (2026-10-20, Ben: "viewing a specific function in
// this code view should have the error checking taken from the parent whole
// script file — it's just a different view of this script file object, not a
// new object in itself").
//
// The editor's model is the WHOLE file, at the file's own path; a function
// view hides the lines outside the function (setHiddenAreas, the mechanism
// folding uses) and tracks the function's span as it is edited. So the
// language service reads the function inside its file — the imports it uses
// are declared above it, a .tsx is parsed as a .tsx — and the line numbers are
// the file's. Before, the editor was handed the function's lines alone as an
// anonymous model: every imported name read "Cannot find name", and JSX in a
// .tsx read as an error, because the snippet had no imports and no extension.
//
// Save still sends the span's text alone (the CST rewriter's
// replace_function_body); nothing outside the span can be edited, since
// nothing outside it is shown.

import type { Monaco, OnMount } from "@monaco-editor/react";

type CodeEditor = Parameters<OnMount>[0];

/** The model path for a file — one model per file, named as the file. */
export const fileModelPath = (filePath: string): string => `file:///${filePath.replace(/^\/+/, "")}`;

/** 1-based, inclusive lines of the file a view shows; null = the whole file. */
export interface Span { start: number; end: number }

const HIDE = "vg-file-view";

/**
 * Show `span` of the editor's (whole-file) model and hide the rest. Returns
 * the decoration that tracks the span through edits — pass it back on the
 * next call, and to `spanText`.
 */
export function showSpan(editor: CodeEditor, monaco: Monaco, span: Span | null, previous: string[]): string[] {
  const model = editor.getModel();
  if (!model) return [];
  const last = model.getLineCount();
  const hidden: Array<InstanceType<Monaco["Range"]>> = [];
  if (span) {
    if (span.start > 1) hidden.push(new monaco.Range(1, 1, span.start - 1, 1));
    if (span.end < last) hidden.push(new monaco.Range(span.end + 1, 1, last, 1));
  }
  // Not in the public typings, but on every code editor since folding
  // (the diff editor's hide-unchanged-regions uses it too). FORCED: a model
  // reset (Cancel, a refresh) flushes the view's hidden lines, while the
  // editor still remembers this source's last ranges — the same ranges again
  // would be skipped as "no change" and the whole file would show.
  (editor as unknown as { setHiddenAreas?: (r: unknown[], source?: unknown, forceUpdate?: boolean) => void }).setHiddenAreas?.(hidden, HIDE, true);
  const ids = model.deltaDecorations(previous, span
    ? [{
      range: new monaco.Range(span.start, 1, Math.min(span.end, last), model.getLineMaxColumn(Math.min(span.end, last))),
      options: { stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
    }]
    : []);
  if (span) editor.revealLineNearTop(span.start, 1 /* Immediate */);
  else editor.setScrollTop(0);
  return ids;
}

/**
 * Keep the cursor and every selection inside the shown span. The hidden lines
 * are still in the model, and Ctrl+End, Ctrl+Home, Ctrl+A and Page Down would
 * otherwise carry the cursor into them — typing there edits text nobody can
 * see (found by the save-error spec: its Ctrl+End, Enter and typing landed
 * after the end of the file, and Save stayed disabled). A whole-file view has
 * no span, and nothing to keep.
 */
export function confineToSpan(editor: CodeEditor, decorations: () => string[]): { dispose(): void } {
  let busy = false;
  return editor.onDidChangeCursorSelection(() => {
    const model = editor.getModel();
    const id = decorations()[0];
    if (busy || !model || !id) return;
    const r = model.getDecorationRange(id);
    if (!r) return;
    const lo = { lineNumber: r.startLineNumber, column: 1 };
    const hi = { lineNumber: r.endLineNumber, column: model.getLineMaxColumn(r.endLineNumber) };
    const clamp = (p: { lineNumber: number; column: number }) => (p.lineNumber < lo.lineNumber ? lo : p.lineNumber > hi.lineNumber ? hi : p);
    const selections = editor.getSelections() ?? [];
    let moved = false;
    const next = selections.map((s) => {
      const a = clamp({ lineNumber: s.selectionStartLineNumber, column: s.selectionStartColumn });
      const b = clamp({ lineNumber: s.positionLineNumber, column: s.positionColumn });
      if (a.lineNumber !== s.selectionStartLineNumber || b.lineNumber !== s.positionLineNumber) moved = true;
      return { selectionStartLineNumber: a.lineNumber, selectionStartColumn: a.column, positionLineNumber: b.lineNumber, positionColumn: b.column };
    });
    if (!moved) return;
    busy = true;
    try { editor.setSelections(next); } finally { busy = false; }
  });
}

/** The text the view shows now: the tracked span, or the whole file. */
export function spanText(editor: CodeEditor, decorations: string[]): string {
  const model = editor.getModel();
  if (!model) return "";
  const range = decorations[0] ? model.getDecorationRange(decorations[0]) : null;
  if (!range) return model.getValue();
  return model.getValueInRange({ startLineNumber: range.startLineNumber, startColumn: 1, endLineNumber: range.endLineNumber, endColumn: model.getLineMaxColumn(range.endLineNumber) });
}

/**
 * Errors the language service reports only because it cannot see the
 * project: this editor holds one file, not the node_modules, the sibling
 * files or the tsconfig. They underlined every import of a real project
 * ("Cannot find module 'node:test'") while saying nothing about the code.
 * Everything else — syntax, a misspelled local, a type error inside the file —
 * is still reported.
 */
export const UNSEEN_PROJECT_CODES = [
  2307, // Cannot find module 'x' or its corresponding type declarations
  2792, // Cannot find module 'x'. Did you mean to set 'moduleResolution'…
  7016, // Could not find a declaration file for module 'x'
  2580, 2591, // Cannot find name 'require' / 'process' — Node's typings
  2582, 2593, // Cannot find name 'describe' / 'it' — a test runner's typings
  2875, // This JSX tag requires the module path 'react/jsx-runtime'
  7026, // JSX element implicitly has type 'any' — React's typings
];

let configured = false;

/** Configure the TypeScript / JavaScript service once, for every editor. */
export function configureLanguageService(monaco: Monaco): void {
  if (configured) return;
  configured = true;
  // the TS API moved from monaco.languages.typescript to monaco.typescript
  const ts = (monaco as unknown as { typescript?: unknown }).typescript
    ?? (monaco.languages as unknown as { typescript?: unknown }).typescript;
  const api = ts as undefined | {
    typescriptDefaults: Defaults; javascriptDefaults: Defaults;
  };
  if (!api?.typescriptDefaults) return;
  for (const d of [api.typescriptDefaults, api.javascriptDefaults]) {
    d.setCompilerOptions({
      ...d.getCompilerOptions(),
      target: 99, module: 99, // ESNext
      moduleResolution: 2, // node
      jsx: 1, // preserve: JSX parses without a runtime to emit to
      allowJs: true, allowNonTsExtensions: true, esModuleInterop: true, noEmit: true,
    });
    d.setDiagnosticsOptions({ ...d.getDiagnosticsOptions(), diagnosticCodesToIgnore: UNSEEN_PROJECT_CODES });
  }
}

interface Defaults {
  getCompilerOptions(): Record<string, unknown>;
  setCompilerOptions(o: Record<string, unknown>): void;
  getDiagnosticsOptions(): Record<string, unknown>;
  setDiagnosticsOptions(o: Record<string, unknown>): void;
}
