// Where each kind of item document lives and who may touch it.
export const RESOURCES = [
  { key: "/items/{id}/core", owners: ["loader"], readers: ["api"] },
  { key: "/items/{id}/notes", owners: ["loader"], readers: ["api"] },
  { key: "/items/{id}/tags", owners: ["tagger"], readers: ["api"] },
  { key: "/items/{id}/status", owners: ["loader"], readers: ["watcher"] },
  { key: "/labels/{doc}", owners: ["loader"], readers: ["api"] },
];

export const ZONE_OF: Record<string, string> = {
  "/items/{id}/core": "core",
  "/items/{id}/notes": "notes",
  "/items/{id}/tags": "tags",
  "/items/{id}/status": "status",
  "/labels/{doc}": "label",
};
