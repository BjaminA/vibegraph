import { formatItem } from "../lib/format.js";

export function main(items) {
  return items.map(formatItem);
}
