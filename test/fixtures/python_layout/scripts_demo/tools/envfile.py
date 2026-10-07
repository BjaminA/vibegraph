def load(path):
    """Read KEY=VALUE lines."""
    out = {}
    with open(path) as fh:
        for line in fh:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                out[k] = v
    return out
