// A project-relative path, ALWAYS spelled with "/" (2026-10-02). Every key
// VibeGraph reads — manual seeds, constraint scopes, plan folders, globs, the
// CLI's envelope — is posix; on Windows `path.relative` answers with "\\", and
// the viewer's seeds, rules and module identities all missed. `impl` is a
// test seam: path.win32 exercises the Windows behaviour from any host.
import * as path from "path";

export function posixRel(from: string, to: string, impl: typeof path = path): string {
  return impl.relative(from, to).split(impl.sep).join("/");
}
