import { test } from "node:test";
import { validateIngestBody } from "./schema";
import { csvToRows } from "./format";
import { bearerToken } from "./auth";

function checkRejectsEmptyBatch() {
  const problems = validateIngestBody({ readings: [] });
  if (!problems.includes("readings must not be empty")) {
    throw new Error("empty batch must be rejected");
  }
}

function checkCsvParsesByHeader() {
  const rows = csvToRows("device_id,ts,metric,value\nd1,1,temp,20.5\n");
  if (rows.length !== 1 || rows[0].value !== "20.5") {
    throw new Error("csv rows must be keyed by header");
  }
}

function checkBearerTokenShape() {
  if (bearerToken({ headers: { authorization: "Bearer abc" } }) !== "abc") {
    throw new Error("bearer token not extracted");
  }
  if (bearerToken({ headers: {} }) !== null) {
    throw new Error("missing header must be null");
  }
}

test("rejects an empty batch", checkRejectsEmptyBatch);
test("parses the export by header", checkCsvParsesByHeader);
test("extracts the bearer token", checkBearerTokenShape);
