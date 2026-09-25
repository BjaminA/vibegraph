// Quality layer, Run 3: the quality-model DERIVER. Pure over a stack
// profile and the constraint store; writes nothing. Five dimensions, one
// per Run 1 verb outcome; a dimension is EMITTED only when the profile
// names a fact for its applies_when AND at least one check can be
// derived, else it is reported in `notes` and absent (the schema forbids
// a dimension without a check or a predicate without a fact, on purpose).
//
// Where operands come from: `guards` from every stated `calls-through`
// clause (the ordering half that clause admits it lacks), `co-changes`
// from stated clauses, `not-in-loop` from the roles the threads actually
// call, `handles-failure` and `annotated` from the language. Nothing is
// invented: a boundary-integrity dimension with no calls-through stated
// does not exist.
//
// Every dimension is ADVISORY with calibration Unknown until a human
// ratifies the candidate record (scripts/quality_calibrate.mjs); the
// schema's if/then would refuse gate-blocking without one anyway.

import type { ProfileFact, Predicate } from "./predicate.ts";
import type { StackProfile } from "./profile.ts";
import { calibrationRecordFor } from "./standings.ts";

interface ConstraintLike { id: string; kind: string; check?: object; checks?: object[] }
/** A ratified record (human-edited after scripts/quality_calibrate.mjs --ratify) carries a commit; the deriver only ever writes Unknown. */
export type Calibration = { unknown: true; reason: string } | ({ commit: string } & Record<string, unknown>);
export interface Binding { check: Record<string, unknown>; costClass: string; forcedBy: string[]; calibration: Calibration }
export interface Dimension {
  id: string; text: string; applies_when: Predicate; checks: Binding[];
  evidenceClass: "A" | "B"; mode: "advisory" | "gate-blocking";
  threshold: { unknown: true; reason: string } | { value: number; unit: string; calibratedAt: string };
  calibration: Calibration;
}
export interface QualityModel { version: "1.0"; provenance: { kind: "derived"; by: string; commit: string; at: string }; dimensions: Dimension[] }

const BY = "src/server/quality/model.ts";
const TEXT: Record<string, string> = {
  "boundary-integrity": "A boundary the code leaves through is governed by the guard the humans named. The reviewer once approved prose the IR contradicted (h2h2); `guards` adds the ordering half `calls-through` admits it lacks.",
  "failure-visibility": "An except arm that swallows the failure hides it from every layer above. The only shape the IR can call a swallow with confidence is the EMPTY arm; everything else it says as unverifiable with its cause.",
  "repetition-cost": "A per-item external call inside a loop is a round trip per item, however the loop is spelled (M-COMP). A role-only check is often unverifiable on loops over dicts; name the target where a constraint can.",
  "resolvability": "An annotation is what turns a dynamic receiver into a boundary the other checks can see (§5.5, M-RESOLVE). Advisory: its outcome is the other verbs' unverifiable rate.",
  "change-coupling": "If the run changes the trigger it must change the requirement, anywhere in the run (fleet c6, expand/contract). The content of the change is a run, not a delta.",
};
/**
 * A binding's calibration: the ratified record when the verb has earned
 * MAY-GATE, the honest Unknown otherwise.
 *
 * Until 2026-09-21 this only ever returned Unknown, and RUN3 §11 recorded
 * the matching decision ("derived bindings never gate"). That was right
 * while no verb had a standing: a dimension nobody calibrated must not
 * reject anyone's work. Four verbs now have ratified records, and Ben
 * ruled on 2026-09-21 that a calibrated dimension may gate
 * (PLAN-HISTORY). The guard rail that makes it safe is NOT here — it is
 * the baseline the objective gate captures, so a derived gate can only
 * reject an offender the packet INTRODUCED.
 */
const CAL = (rule: string): Calibration =>
  calibrationRecordFor(rule)
  ?? { unknown: true as const, reason: `calibration candidate for ${rule} at reviews/quality-layer/calibration/${rule}.candidate.json awaits a human false-positive review` };

/** A dimension gates when EVERY check it binds is calibrated. One
 *  uncalibrated binding keeps the whole dimension advisory: a gate whose
 *  members are judged on different evidence is not one gate. */
const modeFor = (checks: Binding[]): "advisory" | "gate-blocking" =>
  checks.length && checks.every((b) => "commit" in b.calibration) ? "gate-blocking" : "advisory";
const THRESH = { unknown: true as const, reason: "no number before calibration (brief C.8)" };

function clausesOf(c: ConstraintLike): Record<string, unknown>[] { return [...(c.checks ?? []), ...(c.check ? [c.check] : [])] as Record<string, unknown>[]; }
function factHas(f: Record<string, ProfileFact>, name: string, v: string): boolean {
  const x = f[name]?.value; return Array.isArray(x) ? x.includes(v) : x !== undefined && String(x) === v;
}

export function deriveQualityModel(profile: StackProfile, constraints: ConstraintLike[], opts: { commit: string }): { model: QualityModel; notes: string[] } {
  const notes: string[] = [];
  const f = profile.facts;
  const dims: Dimension[] = [];
  const dim = (id: string, applies_when: Predicate, checks: Binding[]) => {
    if (!checks.length) { notes.push(`${id}: no derivable check (see the deriver's rule for where its operands come from) — dimension not emitted`); return; }
    const mode = modeFor(checks);
    dims.push({ id, text: TEXT[id], applies_when, checks, evidenceClass: "A", mode, threshold: THRESH, calibration: CAL(String(checks[0].check.rule)) });
    if (mode === "advisory") {
      const un = checks.filter((b) => !("commit" in b.calibration)).map((b) => String(b.check.rule));
      notes.push(`${id}: advisory — ${[...new Set(un)].join(", ")} ${un.length === 1 ? "has" : "have"} no ratified calibration record`);
    }
  };

  // boundary-integrity: guards from every stated calls-through.
  const calledRoles = Array.isArray(f.rolesCalled?.value) ? f.rolesCalled.value : [];
  {
    const checks: Binding[] = [];
    for (const c of constraints) for (const cl of clausesOf(c)) {
      if (cl.rule === "calls-through" && typeof cl.target === "string" && typeof cl.through === "string") {
        checks.push({ check: { rule: "guards", target: cl.target, guard: cl.through }, costClass: "local", forcedBy: [c.id, "AR-6", "PT-2", "AS-8", "AS-9"], calibration: CAL("guards") });
      }
    }
    if (!calledRoles.length) notes.push("boundary-integrity: the profile names no called role, so no applies_when fact exists");
    else dim("boundary-integrity", { any: calledRoles.map((r) => ({ fact: "rolesCalled", has: r })) }, checks);
  }
  // failure-visibility: handles-failure over the packet's files, Python.
  if (factHas(f, "languages", "python")) {
    dim("failure-visibility", { fact: "languages", has: "python" }, [
      { check: { rule: "handles-failure", scope: "files" }, costClass: "local", forcedBy: ["AS-7", "AS-35", "SP-6"], calibration: CAL("handles-failure") },
    ]);
  } else notes.push("failure-visibility: no Python in the profile; the reporting-call table is Python's");
  // repetition-cost: not-in-loop, NAMED by a stated perf-lever, or none.
  // The h2h3 dry run (2026-09-12) evaluated the role-level form on the
  // pristine fleet example: violated on three of eight packets and
  // unverifiable on four more, on code that had not changed. A webhook
  // post per accepted reading through the alerts funnel IS the design;
  // a role names every boundary where a stated perf-lever names the one
  // that costs. So the derived binding is the stated clause, and a
  // perf-lever with no checkable half derives nothing (the note says so).
  // The grammar keeps `role` for a human to state.
  {
    const roles = calledRoles.filter((r) => ["db", "http-client", "process", "remote", "queue"].includes(r));
    const checks: Binding[] = [];
    for (const c of constraints.filter((x) => x.kind === "perf-lever")) {
      for (const cl of clausesOf(c)) {
        if (cl.rule === "not-in-loop") checks.push({ check: cl, costClass: "thread", forcedBy: [c.id, "AS-10", "VG-3"], calibration: CAL("not-in-loop") });
      }
    }
    const leaves: Predicate[] = [...(f.effectfulLoops ? [{ fact: "effectfulLoops", has: "true" } as Predicate] : []), ...roles.map((r) => ({ fact: "rolesCalled", has: r } as Predicate))];
    if (!checks.length) notes.push("repetition-cost: no stated perf-lever carries a not-in-loop clause; the role-level form fired on pristine code (h2h3 dry run) and is not derived");
    else if (!leaves.length) notes.push("repetition-cost: no effectful loop and no effectful role called; no applies_when fact");
    else dim("repetition-cost", { any: leaves }, checks);
  }
  // resolvability: annotated at the receivers the thread reports dynamic,
  // Python. The `entry-point` mode is NOT derived: calibration (RUN3.md
  // section 10) showed it firing on entry points whose parameters receive
  // no dynamic call, where the annotation would resolve nothing. It stays
  // in the grammar for a human to state as a style rule.
  if (factHas(f, "languages", "python")) {
    dim("resolvability", { fact: "languages", has: "python" }, [
      { check: { rule: "annotated", at: "dynamic-receivers" }, costClass: "local", forcedBy: ["PT-6", "AS-15", "VG-4"], calibration: CAL("annotated") },
    ]);
  }
  // change-coupling: co-changes from stated clauses only.
  {
    const checks: Binding[] = [];
    for (const c of constraints) for (const cl of clausesOf(c)) {
      if (cl.rule === "co-changes" && typeof cl.when === "string" && typeof cl.require === "string") {
        checks.push({ check: { rule: "co-changes", when: cl.when, require: cl.require }, costClass: "delta", forcedBy: [c.id, "AS-21", "AS-5"], calibration: CAL("co-changes") });
      }
    }
    if (!f.languages) notes.push("change-coupling: no languages fact");
    else dim("change-coupling", { any: (Array.isArray(f.languages.value) ? f.languages.value : []).map((l) => ({ fact: "languages", has: l })) }, checks);
  }

  return { model: { version: "1.0", provenance: { kind: "derived", by: BY, commit: opts.commit, at: new Date().toISOString() }, dimensions: dims }, notes };
}
