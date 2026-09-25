// M-CRYSTAL.1 — build-time stand-in for @xyflow/react in the CLI bundle.
//
// src/webview/system/threadInteraction.ts derives the thread call graph
// (which the export needs) and ALSO decorates its edges for react-flow
// (which a CLI does not render). The only react-flow values it touches are
// these two enums, so the bundle aliases the package to this file rather
// than shipping react-flow and React inside a command-line tool. esbuild
// fails the build if the module ever imports a member this stub lacks —
// a build-time error, never a runtime one.
export const Position = Object.freeze({ Left: "left", Top: "top", Right: "right", Bottom: "bottom" });
export const MarkerType = Object.freeze({ Arrow: "arrow", ArrowClosed: "arrowclosed" });
