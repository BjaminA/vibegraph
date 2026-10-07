// WHICH MACHINE THIS IS (2026-10-07). VibeGraph runs on Windows, on Linux, on
// macOS — and inside WSL, which is Linux with a Windows desktop next to it:
// its PATH carries Windows programs (/mnt/c/…), it has no browser of its own,
// and `xdg-open` there usually opens nothing. Every OS-dependent choice asks
// this one module rather than testing `process.platform` itself:
//
//   detectHost()      windows | wsl | linux | mac (+ the WSL distro)
//   openUrlCommands() how to show a URL to the person, in order
//   isWindowsSide()   a path that is a Windows program seen from WSL
//   pythonBin()       the Python every spawn uses (VG_PYTHON, else python3)

import * as fs from "node:fs";

export type HostKind = "windows" | "wsl" | "linux" | "mac";
export interface Host { kind: HostKind; distro?: string }

export function detectHost(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, readProc: () => string = () => fs.readFileSync("/proc/version", "utf-8")): Host {
  if (platform === "win32") return { kind: "windows" };
  if (platform === "darwin") return { kind: "mac" };
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return { kind: "wsl", ...(env.WSL_DISTRO_NAME ? { distro: env.WSL_DISTRO_NAME } : {}) };
  try { if (/microsoft/i.test(readProc())) return { kind: "wsl" }; } catch { /* no /proc */ }
  return { kind: "linux" };
}

/** Ways to open a URL in the person's browser, best first; each run with no shell. */
export function openUrlCommands(url: string, host: Host = detectHost()): Array<{ cmd: string; args: string[]; cwd?: string }> {
  switch (host.kind) {
    case "mac": return [{ cmd: "open", args: [url] }];
    // rundll32 hands the URL to the default browser without cmd's parsing
    // (a `&` in a query string would end a `start` command)
    case "windows": return [{ cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] }, { cmd: "explorer.exe", args: [url] }];
    // WSL: the Windows browser, through interop; from a Windows folder, so
    // cmd does not warn that a \\wsl.localhost path is not supported
    case "wsl": return [
      { cmd: "wslview", args: [url] },
      { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url], cwd: "/mnt/c" },
      { cmd: "powershell.exe", args: ["-NoProfile", "-Command", "Start-Process", `'${url.replace(/'/g, "''")}'`], cwd: "/mnt/c" },
      { cmd: "xdg-open", args: [url] },
    ];
    default: return [{ cmd: "xdg-open", args: [url] }, { cmd: "gio", args: ["open", url] }, { cmd: "sensible-browser", args: [url] }];
  }
}

/** A path that, seen from WSL, is a Windows program (/mnt/c/…): it runs, but
 *  against Windows paths and a Windows home — a Linux one is preferred. */
export const isWindowsSide = (p: string) => /^\/mnt\/[a-z]\//i.test(p);

/** The Python interpreter every spawn uses: VG_PYTHON (what `view` resolved), else python3. */
export function pythonBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.VG_PYTHON?.trim() || "python3";
}
