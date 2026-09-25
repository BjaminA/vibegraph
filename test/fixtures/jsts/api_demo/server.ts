// api_demo — M-LANG3 fixture. Shaped to pin: express route discovery on
// NAMED handlers, cross-file import linking into db.ts, isAsync, the
// log effect (console), param-receiver honesty (res.json → dynamic),
// and dynamic import() honesty.
import express from "express";
import { queryUsers, insertUser } from "./db";

const app = express();

/** List every user, capped at 25 — warns when the table is empty. */
export async function listUsers(req, res) {
  const users = await queryUsers(25);
  if (users.length === 0) {
    console.warn("no users yet");
  }
  res.json(users);
}

export async function createUser(req, res) {
  if (req.query.plugins) {
    await loadPlugins();
  }
  const created = await insertUser(req.body);
  res.status(201);
  res.json(created);
}

async function loadPlugins() {
  const mod = await import("./plugins.js");
  return mod;
}

app.get("/users", listUsers);
app.post("/users", createUser);
app.listen(3000);
