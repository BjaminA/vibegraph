import React, { useState } from "react";
import { X, Plus } from "lucide-react";
import type { SymbolEntry } from "./types";

// ── symbol helpers ────────────────────────────────────────────────────────────

function getByKind(symbols: SymbolEntry[], kind: SymbolEntry["kind"]) {
  return [...new Set(symbols.filter((s) => s.kind === kind).map((s) => s.name))];
}

function getVariables(symbols: SymbolEntry[]) {
  return [...new Set(symbols.filter((s) => s.kind === "variable" || s.kind === "import").map((s) => s.name))];
}

function loopVarGuess(iterable: string): string {
  if (!iterable) return "item";
  const singular: Record<string, string> = {
    items: "item", names: "name", values: "value", words: "word",
    lines: "line", rows: "row", files: "file", args: "arg",
    xs: "x", ys: "y", ns: "n",
  };
  return singular[iterable] ?? (iterable.replace(/s$/, "") || "item");
}

// ── code synthesis (pure TypeScript, no Claude) ───────────────────────────────

function synthesizeForLoop(variable: string, iterable: string, body: string): string {
  const v = variable || "item";
  const it = iterable || "items";
  const b = body || "pass";
  return `for ${v} in ${it}:\n    ${b}\n`;
}

function synthesizeCall(funcName: string, args: string): string {
  return `${funcName || "func"}(${args})\n`;
}

function synthesizeAssignment(target: string, value: string): string {
  return `${target || "result"} = ${value || "None"}\n`;
}

function synthesizeFunctionDef(name: string, params: string): string {
  const p = params.trim();
  return `def ${name || "my_function"}(${p}):\n    pass\n`;
}

function synthesizeIfStmt(condition: string, body: string): string {
  return `if ${condition || "True"}:\n    ${body || "pass"}\n`;
}

// ── template cards ────────────────────────────────────────────────────────────

interface AddStubFn {
  (constructType: string, source: string): void;
}

function TemplateSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          background: open ? "color-mix(in oklab, var(--accent-chat) 8%, transparent)" : "transparent",
          border: "none",
          borderBottom: "1px solid var(--border-edge)",
          color: open ? "var(--accent-chat)" : "var(--text-muted)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          padding: "7px 10px",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "monospace",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ padding: "8px 10px 0" }}>{children}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3, fontFamily: "monospace" }}>
        {label}
      </div>
      {options && options.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            background: "var(--bg-canvas)",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-primary)",
            fontSize: 11,
            fontFamily: "monospace",
            padding: "4px 6px",
            outline: "none",
          }}
        >
          <option value="">— choose —</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            background: "var(--bg-canvas)",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-primary)",
            fontSize: 11,
            fontFamily: "monospace",
            padding: "4px 6px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        marginTop: 4,
        background: "color-mix(in oklab, var(--accent-compose) 10%, transparent)",
        border: "1px solid color-mix(in oklab, var(--accent-compose) 30%, transparent)",
        borderRadius: 5,
        color: "var(--accent-compose)",
        fontSize: 11,
        fontWeight: 700,
        padding: "5px 0",
        cursor: "pointer",
        fontFamily: "monospace",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Plus size={16} strokeWidth={1.5} />
      Add to canvas
    </button>
  );
}

// ── construct forms ────────────────────────────────────────────────────────────

function ForLoopForm({ symbols, onAdd }: { symbols: SymbolEntry[]; onAdd: AddStubFn }) {
  const vars = getVariables(symbols);
  const fns = getByKind(symbols, "function");
  const [iterable, setIterable] = useState(vars[0] ?? "");
  const [bodyFn, setBodyFn] = useState(fns[0] ?? "");
  const autoVar = loopVarGuess(iterable);
  const bodyStr = bodyFn ? `${bodyFn}(${autoVar})` : "pass";
  const preview = synthesizeForLoop(autoVar, iterable, bodyStr);

  return (
    <div>
      <Field label="Iterable" value={iterable} onChange={setIterable} options={vars} />
      <Field label="Body call (optional)" value={bodyFn} onChange={setBodyFn} options={["", ...fns]} />
      <Preview code={preview} />
      <AddButton onClick={() => onAdd("for_loop", preview)} />
    </div>
  );
}

function CallForm({ symbols, onAdd }: { symbols: SymbolEntry[]; onAdd: AddStubFn }) {
  const fns = getByKind(symbols, "function");
  const vars = getVariables(symbols);
  const [fn, setFn] = useState(fns[0] ?? "");
  const [args, setArgs] = useState(vars[0] ?? "");
  const preview = synthesizeCall(fn, args);

  return (
    <div>
      <Field label="Function" value={fn} onChange={setFn} options={fns} />
      <Field label="Arguments" value={args} onChange={setArgs} options={vars} />
      <Preview code={preview} />
      <AddButton onClick={() => onAdd("call", preview)} />
    </div>
  );
}

function AssignmentForm({ symbols, onAdd }: { symbols: SymbolEntry[]; onAdd: AddStubFn }) {
  const vars = getVariables(symbols);
  const fns = getByKind(symbols, "function");
  const [target, setTarget] = useState("");
  const [value, setValue] = useState(fns[0] ? `${fns[0]}()` : "");
  const preview = synthesizeAssignment(target, value);

  return (
    <div>
      <Field label="Variable name" value={target} onChange={setTarget} />
      <Field label="Value / expression" value={value} onChange={setValue} options={fns.map((f) => `${f}()`)} />
      <Preview code={preview} />
      <AddButton onClick={() => onAdd("assignment", preview)} />
    </div>
  );
}

function FunctionDefForm({ symbols, onAdd }: { symbols: SymbolEntry[]; onAdd: AddStubFn }) {
  const [name, setName] = useState("");
  const [params, setParams] = useState("");
  const preview = synthesizeFunctionDef(name, params);

  return (
    <div>
      <Field label="Function name" value={name} onChange={setName} />
      <Field label="Parameters" value={params} onChange={setParams} />
      <Preview code={preview} />
      <AddButton onClick={() => onAdd("function_def", preview)} />
    </div>
  );
}

function IfForm({ symbols, onAdd }: { symbols: SymbolEntry[]; onAdd: AddStubFn }) {
  const vars = getVariables(symbols);
  const [condition, setCondition] = useState(vars[0] ?? "True");
  const [body, setBody] = useState("pass");
  const preview = synthesizeIfStmt(condition, body);

  return (
    <div>
      <Field label="Condition" value={condition} onChange={setCondition} options={vars} />
      <Field label="Body" value={body} onChange={setBody} />
      <Preview code={preview} />
      <AddButton onClick={() => onAdd("if_stmt", preview)} />
    </div>
  );
}

function Preview({ code }: { code: string }) {
  return (
    <div
      style={{
        background: "var(--bg-canvas)",
        borderRadius: 4,
        padding: "5px 8px",
        marginBottom: 5,
        fontSize: 10,
        color: "var(--text-secondary)",
        lineHeight: 1.5,
        fontFamily: "monospace",
        whiteSpace: "pre",
        overflow: "hidden",
        maxHeight: 64,
        borderLeft: "2px solid color-mix(in oklab, var(--accent-compose) 30%, transparent)",
      }}
    >
      {code}
    </div>
  );
}

// ── main palette ──────────────────────────────────────────────────────────────

interface Props {
  symbols: SymbolEntry[];
  onAddStub: (constructType: string, source: string) => void;
  onClose: () => void;
}

export function ComposePalette({ symbols, onAddStub, onClose }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 230,
        height: "100%",
        background: "var(--bg-node)",
        borderRight: "2px solid var(--border-edge)",
        display: "flex",
        flexDirection: "column",
        zIndex: 800,
        boxShadow: "8px 0 30px hsl(0 0% 0% / 0.4)",
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-edge)",
          display: "flex",
          alignItems: "center",
          background: "var(--bg-node)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "var(--accent-compose)",
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          Compose
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-muted)",
            padding: "2px 8px",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "monospace",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Close"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div
        style={{
          fontSize: 10,
          color: "var(--border-edge)",
          padding: "6px 10px",
          fontFamily: "monospace",
          borderBottom: "1px solid var(--bg-node)",
          flexShrink: 0,
        }}
      >
        Pick a template → Add to canvas → Insert into code
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <TemplateSection title="For Loop">
          <ForLoopForm symbols={symbols} onAdd={onAddStub} />
        </TemplateSection>

        <TemplateSection title="Function Call">
          <CallForm symbols={symbols} onAdd={onAddStub} />
        </TemplateSection>

        <TemplateSection title="Assignment">
          <AssignmentForm symbols={symbols} onAdd={onAddStub} />
        </TemplateSection>

        <TemplateSection title="Function Def">
          <FunctionDefForm symbols={symbols} onAdd={onAddStub} />
        </TemplateSection>

        <TemplateSection title="If Statement">
          <IfForm symbols={symbols} onAdd={onAddStub} />
        </TemplateSection>
      </div>
    </div>
  );
}
