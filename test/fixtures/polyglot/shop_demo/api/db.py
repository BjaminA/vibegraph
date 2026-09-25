"""sqlite persistence for orders.

_get_conn is ANNOTATED so §5.5 return-type inference resolves
`conn.execute` to sqlite3.Connection.execute (honest external, db).
insert_order writes one row PER ITEM inside a loop — a round-trip
lever the thread contract should name.
"""
import sqlite3

DB_PATH = "shop.db"


def _get_conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def list_orders(limit: int) -> list:
    """Newest orders first."""
    conn = _get_conn()
    rows = conn.execute("select id, customer, total from orders order by id desc limit ?", (limit,)).fetchall()
    conn.close()
    return [dict(id=r[0], customer=r[1], total=r[2]) for r in rows]


def insert_order(order: dict) -> int:
    """Insert the order header, then one row PER ITEM."""
    conn = _get_conn()
    cur = conn.execute("insert into orders (customer, total) values (?, ?)", (order["customer"], order["total"]))
    order_id = cur.lastrowid
    for item in order["items"]:
        conn.execute("insert into order_items (order_id, sku, qty) values (?, ?, ?)", (order_id, item["sku"], item["qty"]))
    conn.commit()
    conn.close()
    return order_id
