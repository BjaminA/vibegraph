// 2026-10-01 — a hook installed with `init --hooks --windows` runs inside WSL
// but is handed paths by a Claude Code running on WINDOWS: the project is
// \\wsl.localhost\Ubuntu\home\x\proj there, and an edited file arrives as
// \\wsl.localhost\Ubuntu\home\x\proj\src\a.ts. To this Linux process that is
// a relative name, so the post-edit hook resolved it under the root and
// checked nothing. These are the two spellings Windows has for a path:
//   \\wsl.localhost\<distro>\rest  and  \\wsl$\<distro>\rest  →  /rest
//   C:\rest                                                    →  /mnt/c/rest
// (forward slashes accepted too). Anything else is returned unchanged.

export function fromWindowsPath(p) {
  if (typeof p !== "string") return p;
  const unc = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/][^\\/]+([\\/].*)?$/i.exec(p);
  if (unc) return (unc[1] ?? "/").replace(/\\/g, "/");
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
  return p;
}

/** The hook input with every path field Claude Code sends translated. */
export function hookInputFromWindows(input) {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };
  if (typeof out.cwd === "string") out.cwd = fromWindowsPath(out.cwd);
  if (out.tool_input && typeof out.tool_input === "object") {
    out.tool_input = { ...out.tool_input };
    for (const k of ["file_path", "notebook_path", "path"]) {
      if (typeof out.tool_input[k] === "string") out.tool_input[k] = fromWindowsPath(out.tool_input[k]);
    }
  }
  return out;
}
