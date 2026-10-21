import { cn } from "../lib/utils";

export function buttonClass(primary: boolean): string {
  return cn("button", primary ? "primary" : "");
}
