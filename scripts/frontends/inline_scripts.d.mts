// Types for inline_scripts.mjs, read by the TypeScript side (src/server/source_admission.ts, source_walk.ts).
export interface InlineScript { start: number; end: number; line: number; endLine: number; type: string }
export const HTML_EXTENSIONS: string[];
export function isHtmlPath(p: string | null | undefined): boolean;
export function inlineScripts(html: string): InlineScript[];
export function pageScriptSource(html: string, scripts?: InlineScript[]): string;
