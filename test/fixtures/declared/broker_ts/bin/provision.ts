#!/usr/bin/env node
// Grants: who may read and write each tenant's topics.
import { Kafka } from "kafkajs";
import { topicFor } from "../src/topics.ts";

const env = process.env.APP_ENV ?? "dev";
const tenant = process.argv[2] ?? "t1";
const admin = new Kafka({ clientId: "provision", brokers: ["localhost:9092"] }).admin();
await admin.createTopics({ topics: [{ topic: topicFor(env, "invoices", tenant) }] });
await admin.createAcls({
  acl: [{ resourceType: 2, resourceName: topicFor(env, "invoices", tenant), principal: "User:ledger", operation: 3, permissionType: 3 }],
});
