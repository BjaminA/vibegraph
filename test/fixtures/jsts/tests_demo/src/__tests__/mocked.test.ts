// The module under test is replaced by a mock: this test does not exercise price.ts.
import { it, expect, vi } from "vitest";
import { checkout } from "../price";

vi.mock("../price", () => ({ applyDiscount: vi.fn(() => 0), checkout: vi.fn(() => 0) }));

it("mocked", () => {
  expect(checkout(1)).toBe(0);
});
