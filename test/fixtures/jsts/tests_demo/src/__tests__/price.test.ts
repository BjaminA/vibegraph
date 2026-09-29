// Inline arrows, the way nearly every real suite is written.
import { describe, it, expect } from "vitest";
import { applyDiscount } from "../price";

describe("price", () => {
  it("discounts", () => {
    expect(applyDiscount(100, 0.1)).toBe(90);
  });
});
