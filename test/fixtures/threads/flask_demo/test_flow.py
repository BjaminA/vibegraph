"""Pytest-style seeds.

Filename matches `^test_*\\.py` AND each function name starts with
`test_`, so both halves of the §1.2 test-detection rule fire.
"""

from models import find_user, create_user, list_users


def test_create_then_find():
    user = create_user("alice", "alice@example.com")
    found = find_user(user.uid)
    assert found is not None
    assert found.email == "alice@example.com"


def test_list_returns_users():
    users = list_users()
    assert isinstance(users, list)


def _helper_not_a_test():
    """Leading underscore — must NOT be detected as a test seed."""
    return 42
