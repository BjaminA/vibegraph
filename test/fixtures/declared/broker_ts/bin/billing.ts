#!/usr/bin/env node
// The billing process: issues invoices onto the broker.
import { Kafka } from "kafkajs";
import { issue } from "../src/billing.ts";
import { kafkaPorts } from "../src/kafka_ports.ts";

const env = process.env.APP_ENV ?? "dev";
const kafka = new Kafka({ clientId: "billing", brokers: ["localhost:9092"] });
await issue({ id: "i1", tenant: process.argv[2] ?? "t1", lines: ["a"], total: 10, paid: 0 }, kafkaPorts(kafka, env));
