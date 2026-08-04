// Public entry for the messaging module.
//
// The WebSocket bridge itself lives in `../types.ts` (singleton `bridge`); we
// don't relocate it because every node component imports it from there. What
// this folder owns is the *consumption* side: the App-level message handler
// and the document-level custom event bus, exposed as React hooks.

export { useWebSocketHandler } from "./useWebSocketHandler";
export type { WebSocketHandlerActions, WebSocketHandlerDeps } from "./useWebSocketHandler";
export { useEventBus } from "./useEventBus";
export type { EventBusActions, EventBusDeps, EditState } from "./useEventBus";
export { useSelectionBus } from "./useSelectionBus";
export type { SelectionBusActions } from "./useSelectionBus";
