// Cloud services on the architecture map (2026-09-24). a private production codebase reaches S3
// through @aws-sdk/client-s3 and the presigner, and the map showed no cloud
// at all. Two things were missing:
//
//   * a qualified target under a SCOPED package (`@aws-sdk/client-s3.X`) was
//     read as project code — the path test saw the slash — so no scoped SDK
//     call was ever attributed;
//   * the SERVICE: a provider spells it in the package name, the client
//     constructor's literal argument, or the CLI's first word
//     (src/shared/cloud_services.ts), and one service reached several ways
//     is one box.
//
// Pinned on test/fixtures/arch/cloud_demo: three providers, three languages,
// every spelling.
//
//   npm run test:cloud-services
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { cloudServiceOf } from "../src/shared/cloud_services.ts";
import { attributeBoundary } from "../src/shared/stack_attribution.ts";
import { classifyTool } from "../src/shared/stack_taxonomy.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/arch/cloud_demo");
let model;
before(() => {
  const env = buildPolyglotEnvelope(FIXTURE).envelope;
  model = archModelForEnvelope(env, buildStackIndex(env, FIXTURE), buildCrossingIndex(env), FIXTURE);
});

test("the service is read from the package name, the constructor's literal, or the CLI's first word", () => {
  const svc = (tool, hint) => { const s = cloudServiceOf(tool, hint); return s && [s.label, s.kind, s.from]; };
  // package names, every provider's convention
  assert.deepEqual(svc("@aws-sdk/client-s3"), ["AWS S3", "object-storage", "package"]);
  assert.deepEqual(svc("@aws-sdk/s3-request-presigner"), ["AWS S3", "object-storage", "package"], "a helper names the service it wraps");
  assert.deepEqual(svc("@aws-sdk/client-dynamodb"), ["AWS DynamoDB", "database", "package"]);
  assert.deepEqual(svc("@aws-sdk/credential-provider-cognito-identity"), ["AWS credentials", "auth", "package"]);
  assert.deepEqual(svc("@google-cloud/storage"), ["Google Cloud Storage", "object-storage", "package"]);
  assert.deepEqual(svc("@google-cloud/pubsub"), ["Google Cloud Pub/Sub", "queue", "package"]);
  assert.deepEqual(svc("@azure/storage-blob"), ["Azure Blob Storage", "object-storage", "package"]);
  assert.deepEqual(svc("@azure/cosmos"), ["Azure Cosmos DB", "database", "package"]);
  assert.deepEqual(svc("google.cloud.bigquery"), ["Google Cloud BigQuery", "analytics", "package"]);
  assert.deepEqual(svc("azure.storage.blob"), ["Azure Blob Storage", "object-storage", "package"]);
  assert.deepEqual(svc("aws_sdk_sqs"), ["AWS SQS", "queue", "package"], "Rust's crate convention");
  // constructor literals
  assert.deepEqual(svc("boto3", { constructorArgs: ['"s3"'] }), ["AWS S3", "object-storage", "constructor"]);
  assert.deepEqual(svc("boto3", { constructorArgs: ["'sqs'"] }), ["AWS SQS", "queue", "constructor"]);
  assert.deepEqual(svc("aws-sdk", { constructorArgs: ["S3"] }), ["AWS S3", "object-storage", "constructor"], "v2: new AWS.S3()");
  // CLI words
  assert.deepEqual(svc("aws", { cliArgs: ["s3", "cp", "a", "b"] }), ["AWS S3", "object-storage", "cli"]);
  assert.deepEqual(svc("gsutil", { cliArgs: ["cp", "a", "gs://b"] }), ["Google Cloud Storage", "object-storage", "cli"]);
  assert.deepEqual(svc("az", { cliArgs: ["storage", "blob", "upload"] }), ["Azure Blob Storage", "object-storage", "cli"]);
  // Nothing names the service: the provider is kept, the service is not guessed.
  assert.deepEqual(svc("boto3", { constructorArgs: ["region"] }), ["AWS (service not named)", "other", "none"]);
  // Not a cloud provider's tool.
  assert.equal(cloudServiceOf("pg"), null);
  assert.equal(cloudServiceOf("requests"), null);
});

test("@azure/* is cloud only where it names a data service — the scope straddles roles", () => {
  assert.equal(classifyTool("jsts", "@azure/storage-blob").role, "cloud");
  assert.equal(classifyTool("jsts", "@azure/service-bus").role, "cloud");
  assert.equal(classifyTool("jsts", "@azure/identity").role, "unknown");
  assert.equal(classifyTool("jsts", "@azure/msal-node").role, "unknown");
});

test("a qualified target under a SCOPED package is that package, not project code", () => {
  const a = attributeBoundary({
    language: "jsts", label: "GetObjectCommand", kind: "external", qualifiedTarget: "@aws-sdk/client-s3.GetObjectCommand",
    effectKind: null, file: "scripts/get.mjs", irNodeId: "module/main.fn/command.assign",
    imports: [{ binding: "GetObjectCommand", spec: "@aws-sdk/client-s3", nodeId: "module/aws.import_from" }],
    stack: { tools: [] },
  });
  assert.equal(a.tool, "@aws-sdk/client-s3");
  assert.equal(a.role, "cloud");
  assert.equal(a.origin, "third-party");
  assert.equal(a.projectModule, undefined);
  // A project path is still project code.
  const p = attributeBoundary({
    language: "jsts", label: "helper", kind: "external", qualifiedTarget: "lib/util.ts.helper",
    effectKind: null, file: "a.ts", irNodeId: "module/x.call", imports: [], stack: { tools: [] },
  });
  assert.equal(p.origin, "project");
});

test("the fixture: one box per SERVICE, each gathering every spelling that reaches it", () => {
  const clouds = model.nodes.filter((n) => n.id.startsWith("tool:cloud:"));
  assert.deepEqual(clouds.map((n) => [n.id, n.label, n.category]).sort(), [
    ["tool:cloud:aws:dynamodb", "AWS DynamoDB", "database"],
    ["tool:cloud:aws:s3", "AWS S3", "cloud"],
    ["tool:cloud:azure:storage-blob", "Azure Blob Storage", "cloud"],
    ["tool:cloud:gcp:pubsub", "Google Cloud Pub/Sub", "queue"],
    ["tool:cloud:gcp:storage", "Google Cloud Storage", "cloud"],
  ]);
  // S3 is reached four ways, from three languages: one box.
  const s3 = clouds.find((n) => n.id === "tool:cloud:aws:s3");
  assert.equal(s3.sublabel, "object storage · @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, aws, boto3");
  const users = (id) => model.edges.filter((e) => e.to === id).map((e) => e.from).sort();
  assert.deepEqual(users("tool:cloud:aws:s3"), ["cluster:cli-argparse:.", "cluster:scripts:.", "cluster:web:web"]);
  // No raw SDK box is left beside its service.
  assert.equal(model.nodes.filter((n) => /^tool:(@aws-sdk|@google-cloud|@azure|boto3|aws|gsutil|az)\b/.test(n.id)).length, 0);
});
