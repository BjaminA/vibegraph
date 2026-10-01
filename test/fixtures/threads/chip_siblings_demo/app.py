"""Two sibling loops around the SAME function (one card however many blocks
call it), one of them doing more: their containers start at the same corner
with different sizes, which is how two chips once printed on one spot."""


def check(item):
    return bool(item)


def save(item):
    print(item)


def main(entities=("a", "b"), labels=("x",)):
    for e in entities:
        check(e)
        save(e)
    for label in labels:
        check(label)


if __name__ == "__main__":
    main()
