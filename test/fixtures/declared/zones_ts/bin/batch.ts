#!/usr/bin/env node
// A batch job that signs in as each person in turn.
import { readFileSync } from "node:fs";
import { connect } from "../src/store.ts";

const people: Array<{ id: string; config: string }> = JSON.parse(readFileSync("people.json", "utf8"));
for (const person of people) {
  const client = connect(person.config);
  client.destroy();
}
