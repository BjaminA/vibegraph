// The ports on a real broker: the object literal that implements BillingPorts.
import { Kafka } from "kafkajs";
import type { BillingPorts } from "./ports.ts";
import { auditTopic, topicFor } from "./topics.ts";

export function kafkaPorts(kafka: Kafka, env: string): BillingPorts {
  const producer = kafka.producer();
  return {
    publishInvoice: async (inv) => {
      await producer.send({ topic: topicFor(env, "invoices", inv.tenant), messages: [{ key: inv.id, value: JSON.stringify(inv) }] });
    },
    loadTenant: async (id) => ({ id, standing: "ok" }),
    audit: async (line) => {
      await producer.send({ topic: auditTopic(env), messages: [{ value: line }] });
    },
  };
}
