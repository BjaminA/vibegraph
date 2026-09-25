/**
 * PLAN-M-RUNTIME phase 3 — the BASH RUN FLOOR.
 *
 * The floor's claim is "nothing external can run". This pins the one
 * exception that claim has to state out loud: a REDIRECTION is not a
 * command, so no PATH trick touches it, and an absolute-path redirect is
 * refused rather than run with a caveat.
 *
 * Run: npm run test:bash-floor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBashTrace, BASH_TRACE_LIMITS } from "../src/server/bash_floor.ts";

const at = (source, commands = []) =>
  assessBashTrace({ sources: { "deploy.sh": source }, commands });

test("a script with no absolute redirect is traceable, and says what will be intercepted", () => {
  const r = at("rm -rf build/\ncurl -T x https://example.com\n", ["rm", "curl", "psql"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.commands, ["curl", "psql", "rm"], "sorted and deduped");
  assert.match(r.reason, /RECORDED, not executed/);
  assert.match(r.reason, /curl, psql, rm/);
  // The prize is named in the consent, because it is the reason to say yes.
  assert.match(r.reason, /\$CMD` and `eval` expand for real/);
});

test("an ABSOLUTE redirect is REFUSED — the one thing a stubbed PATH cannot stop", () => {
  const r = at('echo hi > /etc/hosts\n', ["echo"]);
  assert.equal(r.ok, false);
  assert.equal(r.absoluteRedirects.length, 1);
  assert.equal(r.absoluteRedirects[0].target, "/etc/hosts");
  assert.equal(r.absoluteRedirects[0].line, 1);
  assert.match(r.reason, /A redirection is not a command/);
});

test("every absolute-redirect spelling is caught — over-refusing is the safe direction", () => {
  for (const line of [
    "echo x > /tmp/a",
    "echo x >> /var/log/b",
    "cmd 2> /tmp/err",
    "cmd &> /tmp/both",
    "cmd >| /tmp/clobber",
    'echo x > "/tmp/quoted"',
    "cmd 1>>/tmp/append",
  ]) {
    assert.equal(at(line).ok, false, `should refuse: ${line}`);
  }
});

test("a RELATIVE redirect is fine — the throwaway project copy contains it", () => {
  for (const line of [
    "echo x > build/out.txt",
    "cmd >> logs/app.log",
    "cmd 2> err.txt",
    "tar -czf out.tgz src/",
  ]) {
    assert.equal(at(line).ok, true, `should allow: ${line}`);
  }
  // A READ from an absolute path is not a write and is not refused.
  assert.equal(at("while read -r l; do :; done < /var/log/app.log").ok, true);
});

test("a comment describing a redirect does not block a run", () => {
  assert.equal(at("# never do: echo x > /etc/passwd\nls\n").ok, true);
  // ...but a `#` inside quotes is not a comment, and the check stays
  // conservative there rather than getting clever.
  assert.equal(at('echo "a # b" > /etc/passwd').ok, false);
});

test("every sourced file is checked, not just the entry script", () => {
  const r = assessBashTrace({
    sources: { "deploy.sh": "source lib/common.sh\n", "lib/common.sh": "echo x > /etc/motd\n" },
    commands: ["echo"],
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /lib\/common\.sh:1/);
});

test("the limits are STATED, not implied — a floor that only says what it prevents is half a floor", () => {
  assert.equal(BASH_TRACE_LIMITS.length, 3);
  assert.ok(BASH_TRACE_LIMITS.some((l) => /branches on a command's output/.test(l)),
    "the divergence a stubbed command causes is the honest headline limit");
  assert.ok(BASH_TRACE_LIMITS.some((l) => /command -v/.test(l)));
  assert.ok(BASH_TRACE_LIMITS.some((l) => /builtins/.test(l)));
});

test("a script with no external commands still reports a usable reason", () => {
  const r = at("x=1\necho $x\n", []);
  assert.equal(r.ok, true);
  assert.match(r.reason, /No external commands found/);
  assert.match(r.reason, /recorded, not executed/);
});
