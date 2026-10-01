// Types for workspace.mjs, read by the TypeScript side (src/server/import_graph.ts).
export interface WorkspacePackageRecord { dir: string; name: string; manifest: Record<string, unknown> }
export function workspacePackages(base: string, under?: string): WorkspacePackageRecord[];
export function resolveWorkspaceTarget(spec: string, relFile: string, base: string): string | null;
export function _clearWorkspaceCache(): void;
