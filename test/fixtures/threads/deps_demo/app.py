"""deps_demo — fixture for the missing-deps banner (NEXT-ACTIONS §2).

Declares one third-party import that is deliberately NOT installed in
.pydeps (`vg_absent_dep_zz`) alongside stdlib + local imports that must
never be flagged.
"""
import json
import vg_absent_dep_zz

from helpers import shout


def main():
    payload = {"msg": shout("hello")}
    vg_absent_dep_zz.send(json.dumps(payload))


if __name__ == "__main__":
    main()
