#!/usr/bin/env node
// The ledger process: consumes invoices, publishes payments. It never calls billing.
import { Kafka } from "kafkajs";
import { topicFor, shardTopic } from "../src/topics.ts";

const env = process.env.APP_ENV ?? "dev";
const tenant = process.argv[2] ?? "t1";
const kafka = new Kafka({ clientId: "ledger", brokers: ["localhost:9092"] });
const consumer = kafka.consumer({ groupId: "ledger" });
const producer = kafka.producer();
await consumer.subscribe({ topic: topicFor(env, "invoices", tenant) });
await consumer.run({
  eachMessage: async ({ message }) => {
    await producer.send({ topic: topicFor(env, "payments", tenant), messages: [{ value: message.value }] });
    await producer.send({ topic: shardTopic(env, tenant), messages: [{ value: message.value }] });
  },
});
