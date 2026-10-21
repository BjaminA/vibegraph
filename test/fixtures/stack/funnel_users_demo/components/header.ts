import { cn } from "../lib/utils";

export function headerClass(active: boolean): string {
  return cn("header", active ? "active" : "");
}
