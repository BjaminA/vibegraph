import { test } from "node:test";
import { validateOrderInput } from "./schema";

function checkRejectsEmpty() {
  const problems = validateOrderInput({ customer: "", items: [] });
  if (problems.length !== 2) {
    throw new Error("expected two problems");
  }
}

test("rejects an empty order", checkRejectsEmpty);
