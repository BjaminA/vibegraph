"""argparse-driven CLI for flask_demo.

The `if __name__ == "__main__":` block calls `main()` directly, so the
M8.2 cli detector should resolve the entry point to `cli:main`.
The `argparse.ArgumentParser` call inside main() is a secondary cli
signal but should dedupe against the if-name-main entry.
"""

import argparse

from models import list_users, create_user


def cmd_list():
    for u in list_users():
        print(f"{u.uid}\t{u.name}\t{u.email}")


def cmd_create(name, email):
    user = create_user(name, email)
    print(f"created uid={user.uid}")


def main():
    parser = argparse.ArgumentParser(description="flask_demo CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="list all users")
    create = sub.add_parser("create", help="add a user")
    create.add_argument("name")
    create.add_argument("email")
    args = parser.parse_args()
    if args.cmd == "list":
        cmd_list()
    elif args.cmd == "create":
        cmd_create(args.name, args.email)


if __name__ == "__main__":
    main()
