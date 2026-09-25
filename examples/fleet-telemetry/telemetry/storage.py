"""sqlite persistence for readings and devices.

The connection factory is annotated so callers' `conn.execute` resolves
to sqlite3.Connection.execute statically.
"""

import sqlite3

DB_PATH = "telemetry.db"
SCHEMA = """
create table if not exists readings (
  id integer primary key,
  device_id text not null,
  ts integer not null,
  metric text not null,
  value real not null,
  received_at integer not null
);
create table if not exists devices (
  device_id text primary key,
  label text,
  first_seen integer not null
);
create index if not exists readings_device_ts on readings (device_id, ts);
"""


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def insert_readings(readings: list) -> int:
    """Insert a batch in ONE transaction; returns the row count."""
    conn = _get_conn()
    conn.executemany(
        "insert into readings (device_id, ts, metric, value, received_at) values (?, ?, ?, ?, ?)",
        [(r["device_id"], r["ts"], r["metric"], r["value"], r["received_at"]) for r in readings],
    )
    conn.commit()
    conn.close()
    return len(readings)


def latest_for_device(device_id: str) -> list:
    """The newest reading per metric for one device."""
    conn = _get_conn()
    rows = conn.execute(
        "select metric, value, max(ts) from readings where device_id = ? group by metric",
        (device_id,),
    ).fetchall()
    conn.close()
    return [{"metric": r[0], "value": r[1], "ts": r[2]} for r in rows]


def list_devices() -> list:
    """Every device id with a reading, alphabetically."""
    conn = _get_conn()
    rows = conn.execute("select distinct device_id from readings order by device_id").fetchall()
    conn.close()
    return [r[0] for r in rows]


def readings_between(since: int, until: int | None) -> list:
    """Readings in [since, until], oldest first, as dicts."""
    conn = _get_conn()
    if until is None:
        rows = conn.execute(
            "select device_id, ts, metric, value from readings where ts >= ? order by ts", (since,)
        ).fetchall()
    else:
        rows = conn.execute(
            "select device_id, ts, metric, value from readings where ts between ? and ? order by ts",
            (since, until),
        ).fetchall()
    conn.close()
    return [{"device_id": r[0], "ts": r[1], "metric": r[2], "value": r[3]} for r in rows]


def upsert_device(device_id: str, label: str | None, first_seen: int) -> None:
    """Register a device once; later calls only refresh the label."""
    conn = _get_conn()
    conn.execute(
        "insert into devices (device_id, label, first_seen) values (?, ?, ?) "
        "on conflict(device_id) do update set label = coalesce(excluded.label, devices.label)",
        (device_id, label, first_seen),
    )
    conn.commit()
    conn.close()
