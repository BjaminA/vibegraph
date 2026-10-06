// Store paths, built at run time from an item id.
export const itemPath = (id: string, part: string) => `/items/${id}/${part}`;
export const labelPath = (doc: string) => `/labels/${docIdFor(doc)}`;

/** A path as a document id. */
export function docIdFor(path: string): string {
  return path.split("/").filter(Boolean).join("-");
}

/** The tags path, assembled piece by piece (no single template says it). */
export function tagKey(id: string): string {
  return ["", "items", id, "tags"].join("/");
}
