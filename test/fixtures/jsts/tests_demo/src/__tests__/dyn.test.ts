// The dynamic form vi.resetModules() forces: bound by a destructured import().
import { it, expect, vi } from "vitest";

it("dyn", async () => {
  vi.resetModules();
  const { checkout } = await import("../price");
  expect(checkout(100)).toBe(90);
});
