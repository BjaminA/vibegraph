def norm_name(s):
    """A different norm_name: this file's own."""
    return s.replace(" ", "_")


def mint(n):
    return [norm_name(f"id {i}") for i in range(n)]
