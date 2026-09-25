// api_demo/db.test.ts — test entry discovery: an IDENTIFIER callback
// (checkQueryUsers) is the seedable function node.
import { test } from "node:test";
import { queryUsers } from "./db";

async function checkQueryUsers() {
  const users = await queryUsers(1);
  if (users.length > 1) {
    throw new Error("limit ignored");
  }
}

test("queryUsers respects limit", checkQueryUsers);
