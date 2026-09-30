"""A small service on LedgerBox: one reader waits for READY, one does not."""
import ledgerbox


def wait_ready(key):
    """Block until the blob under `key` is READY."""
    return ledgerbox.status(key) == "READY"


def save(key, data):
    ledgerbox.put_blob(key, data)


def load(key):
    return ledgerbox.get_blob(key)


def load_safely(key):
    wait_ready(key)
    return ledgerbox.get_blob(key)


if __name__ == "__main__":
    save("k", b"x")
    print(load("k"), load_safely("k"))
