"""M-COMP fixture — the same N+1, written six ways.

Built because the census found ZERO effectful calls inside a comprehension
across every other fixture and example. That is not evidence the pattern is
rare in the wild; it is evidence our fixtures were written to exercise other
things. Without a fixture that contains one, the suite cannot catch a
regression in the comprehension container, so the container would be
untested the day after it shipped. Same reasoning that built
`test/fixtures/stack/stdlib_demo` for M-TABLES.

Every function here performs the SAME work — N HTTP round trips against a
telemetry API — except `page_once`, which performs exactly one. The claim
the fixture exists to pin is that the round-trip verdict is identical for
every spelling, and that `page_once` is NOT among them.
"""
import requests

API = "https://telemetry.example/v1"


def fetch_loop(ids):
    """The spelled-out loop. This spelling was always reported."""
    out = []
    for uid in ids:
        out.append(requests.get(API + "/" + uid).json())
    return out


def fetch_comp(ids):
    """A list comprehension. Identical N requests; reported by nobody
    before M-COMP, because round-trip detection walks the thread for a
    loop CONTAINER and a comprehension had none."""
    return [requests.get(API + "/" + uid).json() for uid in ids]


def fetch_dict(ids):
    """A dict comprehension — the same again, keyed."""
    return {uid: requests.get(API + "/" + uid).json() for uid in ids}


def fetch_genexp(ids):
    """A generator expression, consumed on the spot by sum(). Lazy, so the
    repetition is only real BECAUSE something consumes it — which is not
    tracked, and is the container's one named limit."""
    return sum(requests.get(API + "/" + uid).status_code for uid in ids)


def filter_live(urls):
    """The call is in the `if` clause, which is evaluated per item — so it
    repeats and belongs INSIDE the container."""
    return [u for u in urls if requests.head(u).ok]


def page_once(url):
    """ONE request, not N. The outermost iterable is evaluated once before
    any element is produced, so this call parents OUTSIDE the container and
    must NOT be reported as a round trip. The negative case is the half of
    this fixture that can actually go wrong quietly."""
    return [row["id"] for row in requests.get(url).json()]


def nm_loop(groups):
    """THE N*M CONTROL. A real nested loop, spelled out."""
    out = []
    for g in groups:
        for uid in g:
            out.append(requests.get(API + "/" + uid).json())
    return out


def nm_two_clauses(groups):
    """ONE comprehension, TWO `for` clauses — a nested loop written on one
    line, and identical in every way to nm_loop. This reported a SINGLE
    loop until the clause walk landed, so an N*M fan-out read as N: the
    second `for` had no container and therefore did not exist."""
    return [requests.get(API + "/" + uid).json() for g in groups for uid in g]


def nm_nested_comps(groups):
    """TWO comprehensions, the inner one being the outer one's element.
    This shape always nested correctly — two comprehension NODES, so two
    containers fell out of it. It sits here so all three spellings of the
    same N*M can be compared in one place; a verdict that agrees with two
    of three is not a verdict."""
    return [[requests.get(API + "/" + uid).json() for uid in g] for g in groups]


def clause_guard(groups):
    """The `if` belongs to the FIRST clause, so it is evaluated once per
    GROUP, not once per uid. One loop, not two — the negative case for the
    clause walk, and the one that goes wrong quietly if `if`s are allowed
    to drift into the next clause's container."""
    return [uid for g in groups if requests.head(API + "/" + g).ok for uid in g]


def clause_iterable(groups):
    """The SECOND clause's iterable runs once per group — inside the first
    loop, outside the second. One loop again."""
    return [uid for g in groups for uid in requests.get(API + "/" + g).json()]


def t3_loop(A):
    """THE DEPTH-3 CONTROL. Three real nested loops, spelled out."""
    out = []
    for a in A:
        for b in a:
            for uid in b:
                out.append(requests.get(API + "/" + uid).json())
    return out


def t3_clauses(A):
    """ONE comprehension, THREE clauses. The clause walk is a `while` over
    libcst's chain, so depth is unbounded by construction — and "by
    construction" is exactly the kind of claim that gets pinned rather than
    trusted."""
    return [requests.get(API + "/" + uid).json() for a in A for b in a for uid in b]


def t3_nodes(A):
    """THREE comprehensions, each the element of the one outside it."""
    return [[[requests.get(API + "/" + uid).json() for uid in b] for b in a] for a in A]


def t3_mixed_node_outside(A):
    """A single-clause comprehension OUTSIDE, a two-clause one as its
    element. This is the case that matters: a NODE boundary composed with a
    CLAUSE boundary, and the depth must come out the same."""
    return [[requests.get(API + "/" + uid).json() for b in a for uid in b] for a in A]


def t3_mixed_clauses_outside(A):
    """The other composition: a TWO-clause comprehension outside, a
    single-clause one as its element — so the inner node is reached from
    inside the outer's LAST clause container."""
    return [[requests.get(API + "/" + uid).json() for uid in b] for a in A for b in a]


def t3_guard_middle(A):
    """A guard on the MIDDLE clause. requests.head runs under TWO loops (per
    b); the element's requests.get runs under THREE (per uid). Two calls,
    two depths, one comprehension."""
    return [requests.get(API + "/" + uid).json()
            for a in A for b in a if requests.head(API + "/" + b).ok for uid in b]


def guard_then_fetch(urls):
    """The comprehension sits in an `if` TEST, which runs in the enclosing
    flow whichever arm is taken — so its container must NOT nest inside the
    then-arm. Traversal only reaches it AFTER the if container is pushed,
    which is precisely the trap."""
    if any(requests.head(u).ok for u in urls):
        return "live"
    return "down"


def loop_over_comp(ids):
    """The comprehension builds the loop's iterable ONCE, before the first
    iteration — so its container is a SIBLING of the for_loop, never a
    child. Nested inside, N requests would read as N per item."""
    for payload in [requests.get(API + "/" + uid).json() for uid in ids]:
        print(payload)


def main():
    ids = ["a", "b", "c"]
    fetch_loop(ids)
    fetch_comp(ids)
    fetch_dict(ids)
    fetch_genexp(ids)
    filter_live([API + "/" + uid for uid in ids])
    page_once(API + "/index")
    guard_then_fetch([API + "/" + uid for uid in ids])
    loop_over_comp(ids)
    nm_loop([ids])
    nm_two_clauses([ids])
    nm_nested_comps([ids])
    clause_guard([ids])
    clause_iterable(ids)
    t3_loop([[ids]])
    t3_clauses([[ids]])
    t3_nodes([[ids]])
    t3_mixed_node_outside([[ids]])
    t3_mixed_clauses_outside([[ids]])
    t3_guard_middle([[ids]])


if __name__ == "__main__":
    main()
