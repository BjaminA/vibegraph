"""Enrich each record's codes. Only `codes` is touched."""
import datetime


def enrich_codes(record, found):
    record["codes"] = sorted(set(record.get("codes", [])) | set(found))
    record["origins"] = record.get("origins", []) + ["enrich"]
    record["updated_at"] = datetime.date.today().isoformat()
    return record


def mark_reviewed(record, when):
    record["reviewed_at"] = when
    return record
