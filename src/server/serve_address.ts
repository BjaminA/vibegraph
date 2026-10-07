// THE ADDRESS THE SERVER ACTUALLY ANSWERS ON (2026-10-07, field report).
// Two ways the CLI opened the wrong page:
//   - the server binds 127.0.0.1, the CLI opened `localhost`; with WSL's
//     mirrored networking Windows tries ::1 for `localhost` first and the
//     request hangs — 127.0.0.1 answered 200 in the same minute;
//   - the port was busy, the server moved to the next one, and the CLI had
//     already built its URL from the first — `--open` showed ANOTHER
//     project's viewer.
// So the server prints the URL it bound (`Open:` line, after it listens),
// the CLI opens exactly that, and a busy port is asked what it is serving.

import * as http from "http";

export const ABOUT_PATH = "/vg-about";

export interface About { app: "vibegraph"; project: string; version: string | null }

export function aboutPayload(project: string, version: string | null): About {
  return { app: "vibegraph", project, version };
}

/** The URL for the address bound: the loopback IP, never the name `localhost`. */
export function servedUrl(host: string, port: number): string {
  const h = host.trim();
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return `http://127.0.0.1:${port}`;
  if (h === "::1" || h === "::") return `http://[::1]:${port}`;
  return `http://${h.includes(":") ? `[${h}]` : h}:${port}`;
}

/** What a server already on `port` says it is, if it is VibeGraph. */
export function probeOtherServer(port: number, timeoutMs = 800): Promise<About | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: ABOUT_PATH, headers: { Host: `127.0.0.1:${port}` }, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; if (body.length > 64_000) req.destroy(); });
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          resolve(j && j.app === "vibegraph" && typeof j.project === "string" ? j : null);
        } catch { resolve(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}
