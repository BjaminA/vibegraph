// Quality layer, Run 3: the applies_when predicate evaluator, shared by
// the quality model, the flow spec and acceptance. Pure. The grammar is
// schemas/quality/quality_model.json#/$defs/Predicate plus flow_spec's
// task leaf. There is no `always`: a predicate that names no fact does
// not exist, and an unknown shape evaluates to false, never to true.
//
// A thread's profile OVERRIDES the project's for the facts it carries
// (RUN2.md, "For Ben": the default; a merge would let a project-level
// `polyglot` reach every thread).

export interface ProfileFact { value: string[] | boolean; confidence: string; supportingNodes: string[]; readFrom: string }
export interface ProfileLike {
  facts: Record<string, ProfileFact>;
  regimes: Array<{ id: string; derivedFrom: string[]; reason?: string }>;
  threads?: Record<string, { facts: Record<string, ProfileFact>; regimes: Array<{ id: string }> }>;
}
export interface TaskFacts { constraintsRouted?: boolean; effectfulBoundaries?: boolean; systemPacket?: boolean; crossLanguage?: boolean; retry?: boolean }

export type Predicate =
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { fact: string; has: string } | { fact: string; absent: true }
  | { regime: string }
  | { task: keyof TaskFacts; is: boolean };

export interface PredicateScope { profile: ProfileLike; entryPointId?: string; task?: TaskFacts }

function factIn(scope: PredicateScope, name: string): ProfileFact | null {
  const t = scope.entryPointId ? scope.profile.threads?.[scope.entryPointId] : undefined;
  return t?.facts[name] ?? scope.profile.facts[name] ?? null;
}
function regimesIn(scope: PredicateScope): Set<string> {
  const t = scope.entryPointId ? scope.profile.threads?.[scope.entryPointId] : undefined;
  return new Set((t?.regimes ?? scope.profile.regimes).map((r) => r.id));
}

export function evaluatePredicate(p: Predicate, scope: PredicateScope): boolean {
  if (!p || typeof p !== "object") return false;
  if ("all" in p) return Array.isArray(p.all) && p.all.length > 0 && p.all.every((q) => evaluatePredicate(q, scope));
  if ("any" in p) return Array.isArray(p.any) && p.any.some((q) => evaluatePredicate(q, scope));
  if ("not" in p) return !evaluatePredicate(p.not, scope);
  if ("regime" in p) return regimesIn(scope).has(p.regime);
  if ("task" in p) return (scope.task?.[p.task] ?? false) === p.is;
  if ("fact" in p) {
    const f = factIn(scope, p.fact);
    if ("absent" in p) return f === null;
    if (f === null) return false;
    return Array.isArray(f.value) ? f.value.includes(p.has) : String(f.value) === p.has;
  }
  return false;
}

/** The facts a predicate reads, for a reason string. */
export function predicateFacts(p: Predicate): string[] {
  if (!p || typeof p !== "object") return [];
  if ("all" in p) return p.all.flatMap(predicateFacts);
  if ("any" in p) return p.any.flatMap(predicateFacts);
  if ("not" in p) return predicateFacts(p.not);
  if ("fact" in p) return [p.fact];
  if ("regime" in p) return [`regime:${p.regime}`];
  if ("task" in p) return [`task:${p.task}`];
  return [];
}
