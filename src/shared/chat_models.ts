/**
 * Models offerable to the GUI chat.
 *
 * VibeGraph historically pinned nothing: it spawned `claude` with no
 * `--model`, so the CLI resolved its own default (settings.json /
 * ANTHROPIC_MODEL). That stays the default here — "Default" sends no
 * model and is indistinguishable from the pre-selector behaviour, so a
 * user who never touches the control is unaffected.
 *
 * The list is deliberately short and shared by both ends: the picker
 * renders it, and the server validates against it so an arbitrary
 * `--model` string from a WS client can never reach the CLI.
 *
 * IDs are the documented ALIASES (`claude-haiku-4-5`, not the dated
 * `claude-haiku-4-5-20251001`) — aliases are the recommended form and
 * never carry a date suffix.
 *
 * Fable 5 is listed but is NOT a default: it costs $10/$50 per MTok
 * against Opus 5's $5/$25, and single turns on hard tasks can run for
 * many minutes — which the chat surfaces as a long-running turn. It also
 * requires an org with 30-day data retention (unavailable under zero
 * data retention), so a ZDR org sees every Fable turn fail. The hint
 * text names the cost so the trade-off is visible at the point of
 * choice rather than in a bill.
 */
export interface ChatModelOption {
  /** `--model` value; null = don't pass the flag at all. */
  id: string | null;
  label: string;
  /** One line on when to pick it — shown in the picker. */
  hint: string;
}

export const CHAT_MODELS: ChatModelOption[] = [
  { id: null, label: "Default", hint: "Whatever your claude CLI is set to" },
  { id: "claude-fable-5", label: "Fable 5", hint: "Most capable — hardest work. 2x Opus cost, slower turns" },
  { id: "claude-opus-5", label: "Opus 5", hint: "Deep edits and hard reasoning — the workhorse" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Balanced speed and capability" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest and cheapest — simple questions" },
];

/** Whitelist check — the server never forwards an unrecognised id. */
export function isKnownChatModel(id: unknown): id is string {
  return typeof id === "string" && CHAT_MODELS.some((m) => m.id === id);
}
