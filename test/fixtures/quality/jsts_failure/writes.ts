// handles-failure in TypeScript (2026-10-01): the swallow shapes and the
// handled ones, side by side. A catch has no type in JS, so every catch is
// broad; an EMPTY one with no comment saying why, and a do-nothing .catch()
// handler are the swallows.
import { report } from "./report";

declare const store: { put(v: number): Promise<void> };

export async function badEmpty() { try { await store.put(1); } catch {} }
export async function goodDeclared() { try { await store.put(2); } catch { /* a missing cache is rebuilt on the next run */ } }
export function goodPromiseDeclared() { store.put(10).catch(() => { /* best effort: the next sync retries */ }); }
export function badPromise() { store.put(3).catch(() => {}); }

export async function goodLogs() { try { await store.put(4); } catch (e) { console.error(e); } }
export async function goodThrows() { try { await store.put(5); } catch (e) { throw new Error("put failed"); } }
export async function goodReturns() { try { await store.put(6); return true; } catch { return false; } }
export async function goodReports() { try { await store.put(7); } catch (e) { report(e); } }
export function goodPromise() { store.put(8).catch((e) => console.warn(e)); }
