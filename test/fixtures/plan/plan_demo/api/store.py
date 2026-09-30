"""Where readings are stored."""
import sqlite3


def insert_reading(pump_id, reading):
    conn = sqlite3.connect("readings.db")
    conn.execute("INSERT INTO readings (pump_id, reading) VALUES (?, ?)", (pump_id, reading))
    conn.commit()
