"""Access rules, evaluated first-match by rowid.

A DENY below a matching PERMIT is inert: the first rule whose actor and
resource match decides, and nothing after it is read.
"""


def evaluate(rules, actor, resource):
    """The first matching rule's verdict, or deny."""
    for rule in sorted(rules, key=lambda r: r["rowid"]):
        if rule["actor"] == actor and rule["resource"] == resource:
            return rule["verdict"]
    return "DENY"


def add_rule(rules, actor, resource, verdict):
    """Append a rule; it takes effect only where no earlier rule matches."""
    rules.append({"rowid": len(rules) + 1, "actor": actor, "resource": resource, "verdict": verdict})
