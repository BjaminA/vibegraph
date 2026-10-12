// THE RUN FLOOR'S KNOWN-PURE LIBRARIES (2026-10-12). scan_effects.py used to
// treat a dotted call on any imported module as a harmless builtin, so
// `serial.Serial(port).write(b"go")` and `paho.mqtt.publish.single(...)`
// scanned PURE and run-to-here would have executed them without consent — a
// sandbox copies files, not a serial port or a broker. The floor now allows a
// third-party library only when it is KNOWN to stay inside the program: its
// role is tensor, data or utility, from the stack tables or a PERSON's
// statement. A role a model proposed (`classify`, agent-stated) never loosens
// the floor; an unclassified library is asked about, never assumed.

import type { StackIndex } from "./stack.ts";

const NO_EFFECT_ROLES = new Set(["tensor", "data", "utility"]);

export function floorPureLibraries(stack: StackIndex): string[] {
  return [...new Set(stack.tools
    .filter((t) => t.origin === "third-party" && NO_EFFECT_ROLES.has(t.role) && t.roleStatedSource !== "agent")
    .map((t) => t.tool))].sort();
}
