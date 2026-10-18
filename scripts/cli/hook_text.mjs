// The inline cap's cut (moved out of hooks.mjs, 2026-10-16, to keep it under
// the 500-line rule): a hook's context over the cap is saved to a file Claude
// must read, so what does not fit is said, never dropped silently.

/** Cut at a line boundary under `room`, and say what was cut and where the
 *  whole of it is. Never a silent truncation. */
export function fitText(text, room, whereFull) {
  if (text.length <= room) return text;
  const note = `\n… (${"{n}"} more characters not shown — the inline limit; ${whereFull})`;
  let cut = text.lastIndexOf("\n", Math.max(0, room - note.length - 12));
  if (cut < room / 3) cut = Math.max(0, room - note.length - 12);
  return text.slice(0, cut) + note.replace("{n}", String(text.length - cut));
}
