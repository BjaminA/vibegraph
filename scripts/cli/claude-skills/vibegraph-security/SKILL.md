---
name: vibegraph-security
description: Security review of a project VibeGraph has analysed (a .vibegraph/ folder, or the vibegraph-knowledge hooks are installed) — where untrusted input reaches a shell, SQL text or eval, what leaves the project and through which tool, which configuration is read but never declared, and which trust boundaries a flow crosses. Use for a security review, threat model, or before exposing a route, script or tool.
---

# Security review with VibeGraph

Commands are deterministic and spend no tokens: `vibegraph-knowledge …` (or
`npx --yes vibegraph-knowledge@latest …`). Files are under `.vibegraph/knowledge/`.

1. **Untrusted input → dangerous sinks.** `vibegraph-knowledge dataflow` (or
   `security.md`): request data, argv, stdin and script arguments followed by
   name through assignments and calls into shell strings, SQL query text,
   eval, list-form subprocess arguments. UNGUARDED = nothing in between;
   review = a condition mentions the value (read it: is it an allow-list?).
   Each finding names the source, the path and the sink call.
2. **What leaves the project.** Each thread contract's "Leaves the project
   through" lists every boundary by tool, with the call text. The attack
   surface is the entry points in `threads/INDEX.md` — routes, CLIs, scripts,
   MCP tools.
3. **Trust and deploy boundaries.** `architecture.md`: which process each
   thread runs in and the groups a person stated (deploy units, trust zones);
   `flows.md` for hops between them. A flow crossing a trust group without an
   auth call on its path is worth a finding.
4. **Configuration.** `configuration.md`: every environment variable read,
   where, and whether any `.env.example` or compose file declares it. An
   undeclared secret-shaped name is a deployment risk.
5. **Rules.** `constraints.md` and `vibegraph-knowledge check`: stack policies
   (forbidden tools) and invariants the team stated.

**Limits — say them in the review.** The data flow is name-based: it does not
follow values through containers, callbacks or a database round trip
(second-order input), and "no findings" is not a clean bill. VibeGraph does no
secret scanning and has no CVE data — run the language's audit tool
(`npm audit`, `pip-audit`, `cargo audit`) for dependencies.
