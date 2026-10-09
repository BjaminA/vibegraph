#!/usr/bin/env node
// The decider: finds every inbox at start-up, then watches them all.
import { Registry, type Client } from "../src/registry.ts";
import { inboxFeed } from "../src/feed.ts";

declare const client: Client;
const registry = new Registry(client);
const inboxes = await registry.inboxes();
const feed = inboxFeed(registry, inboxes);
await feed.readAll();
await feed.watchAll((id) => console.log(id));
