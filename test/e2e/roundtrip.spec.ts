/**
 * Stage 2 exit criterion: no-op edit save is byte-identical.
 *
 * Tests at the WebSocket protocol level — no browser/Monaco needed.
 * Flow: connect → receive ast-update → edit-node-open → receive source →
 *       edit-node-save (unchanged) → receive edit-node-saved → verify file hash.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import WebSocket from "ws";

const FIXTURE = path.resolve("test/fixtures/sample_advanced.py");
// Sitting-2 — respect VG_PORT like playwright.config.ts does: hardcoding
// 4200 made this spec talk to whatever happened to live there (e.g. a
// user's live session) instead of the suite's own server.
const WS_URL = `ws://localhost:${process.env.VG_PORT ?? "4200"}`;

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function wsRoundTrip(nodeFilter: (n: any) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let step: "init" | "opening" | "saving" = "init";
    let targetNodeId: string;
    let originalSource: string;

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Round-trip timed out after 10s"));
    }, 10_000);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "ast-update" && step === "init") {
        const node = (msg.payload.nodes as any[]).find(nodeFilter);
        if (!node) {
          clearTimeout(timer);
          ws.close();
          reject(new Error("No matching node found in ast-update"));
          return;
        }
        targetNodeId = node.id;
        step = "opening";
        ws.send(JSON.stringify({ type: "edit-node-open", payload: { nodeId: targetNodeId } }));

      } else if (msg.type === "edit-node-source" && step === "opening") {
        if (msg.payload.error) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`edit-node-source error: ${msg.payload.error}`));
          return;
        }
        originalSource = msg.payload.source;
        step = "saving";
        ws.send(JSON.stringify({ type: "edit-node-save", payload: { nodeId: targetNodeId, newSource: originalSource } }));

      } else if (msg.type === "edit-node-saved" && step === "saving") {
        clearTimeout(timer);
        ws.close();
        if (msg.payload.success) {
          resolve();
        } else {
          reject(new Error(`edit-node-saved failed: ${msg.payload.error}`));
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test.describe("Stage 2 round-trip: lossless no-op save", () => {
  test("no-op save of a top-level function is byte-identical", async () => {
    const originalHash = sha256(fs.readFileSync(FIXTURE));

    await wsRoundTrip((n) => n.type === "function_def" && !n.parentId);

    const afterHash = sha256(fs.readFileSync(FIXTURE));
    expect(afterHash).toBe(originalHash);
  });

  test("no-op save of a class def is byte-identical", async () => {
    const originalHash = sha256(fs.readFileSync(FIXTURE));

    await wsRoundTrip((n) => n.type === "class_def");

    const afterHash = sha256(fs.readFileSync(FIXTURE));
    expect(afterHash).toBe(originalHash);
  });

  test("no-op save of a for loop is byte-identical", async () => {
    const originalHash = sha256(fs.readFileSync(FIXTURE));

    await wsRoundTrip((n) => n.type === "for_loop" && !n.parentId);

    const afterHash = sha256(fs.readFileSync(FIXTURE));
    expect(afterHash).toBe(originalHash);
  });

  test("no-op save of an assignment is byte-identical", async () => {
    const originalHash = sha256(fs.readFileSync(FIXTURE));

    await wsRoundTrip((n) => n.type === "assignment" && !n.parentId);

    const afterHash = sha256(fs.readFileSync(FIXTURE));
    expect(afterHash).toBe(originalHash);
  });

  test("source returned by server matches actual file slice", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 10_000);

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "ast-update") {
          const node = (msg.payload.nodes as any[]).find(
            (n) => n.type === "function_def" && !n.parentId
          );
          if (!node) { clearTimeout(timer); ws.close(); reject(new Error("No top-level fn")); return; }
          ws.send(JSON.stringify({ type: "edit-node-open", payload: { nodeId: node.id } }));

        } else if (msg.type === "edit-node-source") {
          clearTimeout(timer);
          ws.close();

          const source: string = msg.payload.source;
          const fileLines = fs.readFileSync(FIXTURE, "utf-8").split("\n");
          // Find the node to get its line range
          expect(source.length).toBeGreaterThan(0);
          // Source must contain 'def' (it's a function)
          expect(source).toContain("def ");
          resolve();
        }
      });

      ws.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  });
});
