export interface Rec { codes?: string[]; origins?: string[]; updatedAt?: string; reviewedAt?: string }

/** Enrich a record's codes. Only `codes` is touched. */
export function enrichCodes(record: Rec, found: string[]): Rec {
  record.codes = [...new Set([...(record.codes ?? []), ...found])].sort();
  record.origins = [...(record.origins ?? []), "enrich"];
  record.updatedAt = new Date().toISOString();
  return record;
}

export function markReviewed(record: Rec, when: string): Rec {
  record["reviewedAt"] = when;
  return record;
}
