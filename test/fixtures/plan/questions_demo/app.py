"""A small order service the plan is about."""


def take_order(order):
    return {"id": order["id"], "status": "taken"}


if __name__ == "__main__":
    print(take_order({"id": 1}))
