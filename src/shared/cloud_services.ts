// Which CLOUD SERVICE a cloud tool reaches (2026-09-24).
//
// The stack index knows a tool is `cloud` (stack_taxonomy.ts: `@aws-sdk/*`,
// `@google-cloud/*`, `boto3`, `google.cloud`, the `aws` / `gcloud` / `az`
// CLIs, Rust's `aws_sdk_*`). A reader needs the SERVICE — "AWS S3", not
// "@aws-sdk/client-s3" — and one S3 reached three ways (a JS client, a
// presigner, `aws s3 cp`) is one service.
//
// The generic method: every provider spells the service in ONE of three
// places, by its own convention, so none of this is a list of packages.
//
//   1. the PACKAGE NAME — `@aws-sdk/client-<svc>`, `@google-cloud/<svc>`,
//      `@azure/<svc>`, `google.cloud.<svc>`, `azure.<svc>`, Rust
//      `aws_sdk_<svc>` / `google_cloud_<svc>` / `azure_<svc>`;
//   2. the CLIENT CONSTRUCTOR's literal argument — `boto3.client("s3")`,
//      `boto3.resource("dynamodb")`, `session.client("sqs")`;
//   3. the CLI's first argument — `aws s3 cp`, `gcloud pubsub topics`,
//      `az storage blob`, and `gsutil` is Cloud Storage by definition.
//
// When none of the three says, the provider is still named and the service
// is `unknown` — counted, never guessed. The KIND of a service (object
// storage, database, queue, …) comes from a small per-service table; an id
// the table does not know keeps kind `other`.

export type CloudProvider = "aws" | "gcp" | "azure";
export type CloudKind = "object-storage" | "database" | "queue" | "compute" | "auth" | "secrets" | "analytics" | "other";

export interface CloudService {
  provider: CloudProvider;
  /** the provider's own service id, normalised (`s3`, `storage`, `storage-blob`). */
  service: string;
  /** "AWS S3", "Google Cloud Storage", "Azure Blob Storage". */
  label: string;
  kind: CloudKind;
  /** where the service was read: package | constructor | cli | none. */
  from: "package" | "constructor" | "cli" | "none";
}

const PROVIDER_LABEL: Record<CloudProvider, string> = { aws: "AWS", gcp: "Google Cloud", azure: "Azure" };

/** Service ids that are not the one the package name spells (aliases). */
const ALIAS: Record<string, string> = {
  // AWS: helpers named after the service they wrap
  "s3-request-presigner": "s3", "lib-storage": "s3", "s3-presigned-post": "s3",
  "lib-dynamodb": "dynamodb", "util-dynamodb": "dynamodb",
  "credential-providers": "credentials", "cognito-identity-provider": "cognito-idp",
  // GCP
  "cloud-storage": "storage", gcs: "storage",
  // Azure
  "storage-blob": "storage-blob", "storage-queue": "storage-queue",
};

/** Display names where the id does not title-case well. */
const NAME: Record<string, Record<string, string>> = {
  aws: {
    s3: "S3", dynamodb: "DynamoDB", sqs: "SQS", sns: "SNS", lambda: "Lambda", kinesis: "Kinesis",
    "cognito-identity": "Cognito Identity", "cognito-idp": "Cognito User Pools", credentials: "credentials",
    "secrets-manager": "Secrets Manager", ssm: "Systems Manager", sts: "STS", iam: "IAM",
    eventbridge: "EventBridge", "sfn": "Step Functions", ses: "SES", rds: "RDS", "rds-data": "RDS Data API",
    athena: "Athena", textract: "Textract", bedrock: "Bedrock", "bedrock-runtime": "Bedrock", ecs: "ECS", ec2: "EC2",
    cloudwatch: "CloudWatch", "cloudwatch-logs": "CloudWatch Logs", logs: "CloudWatch Logs", kms: "KMS",
  },
  gcp: {
    storage: "Cloud Storage", pubsub: "Pub/Sub", bigquery: "BigQuery", firestore: "Firestore", datastore: "Datastore",
    spanner: "Spanner", "secret-manager": "Secret Manager", functions: "Cloud Functions", run: "Cloud Run",
    tasks: "Cloud Tasks", logging: "Cloud Logging", vision: "Vision", "documentai": "Document AI", bigtable: "Bigtable",
  },
  azure: {
    "storage-blob": "Blob Storage", "storage-queue": "Queue Storage", cosmos: "Cosmos DB", "service-bus": "Service Bus",
    "event-hubs": "Event Hubs", "keyvault-secrets": "Key Vault", identity: "identity", "data-tables": "Table Storage",
    "ai-form-recognizer": "Form Recognizer", "search-documents": "AI Search",
  },
};

const KIND: Array<[RegExp, CloudKind]> = [
  [/^(s3|storage|storage-blob|gcs|blob|files?|storage-file.*)$/, "object-storage"],
  [/^(dynamodb|firestore|datastore|spanner|bigtable|cosmos|data-tables|rds|rds-data|documentdb|sql)$/, "database"],
  [/^(sqs|sns|pubsub|kinesis|eventbridge|service-bus|event-hubs|storage-queue|tasks|mq)$/, "queue"],
  [/^(lambda|functions|run|ecs|ec2|batch|sfn|compute)$/, "compute"],
  [/^(cognito-identity|cognito-idp|credentials|sts|iam|identity)$/, "auth"],
  [/^(secrets-manager|secret-manager|ssm|kms|keyvault.*)$/, "secrets"],
  [/^(athena|bigquery|glue|redshift|textract|vision|documentai|bedrock.*|ai-.*|search-documents)$/, "analytics"],
];

const kindOf = (svc: string): CloudKind => KIND.find(([re]) => re.test(svc))?.[1] ?? "other";

function titleCase(id: string): string {
  return id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function make(provider: CloudProvider, raw: string | null, from: CloudService["from"]): CloudService {
  const id = raw ? (ALIAS[raw] ?? raw).toLowerCase() : "unknown";
  const name = raw ? (NAME[provider][id] ?? titleCase(id)) : "(service not named)";
  // "Google Cloud" + "Cloud Storage" reads as the product: Google Cloud Storage.
  const label = name.startsWith("Cloud ") && provider === "gcp" ? `Google ${name}` : `${PROVIDER_LABEL[provider]} ${name}`;
  return { provider, service: id, label, kind: raw ? kindOf(id) : "other", from };
}

/** A literal's text without its quotes, or null when it is not a literal. */
function literal(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^\s*(?:[bruf]{0,2})?["'`]([A-Za-z0-9._-]+)["'`]\s*$/.exec(s);
  return m ? m[1] : null;
}

/**
 * The provider and service a cloud tool reaches, or null when the tool is
 * not a cloud provider's.
 *
 * `hint.constructorArgs` — the args of the client constructor the call's
 * receiver was bound from (`boto3.client("s3")` → `['"s3"']`), or of the call
 * itself when it IS the constructor. `hint.cliArgs` — a CLI call's args
 * (`aws s3 cp …` → `["s3", "cp", …]`).
 */
export function cloudServiceOf(tool: string, hint: { constructorArgs?: string[]; cliArgs?: string[] } = {}): CloudService | null {
  // 1. the package name
  let m = /^@aws-sdk\/(?:client-)?([a-z0-9-]+)$/.exec(tool);
  if (m) return make("aws", m[1].startsWith("credential-provider") ? "credentials" : m[1], "package");
  m = /^@google-cloud\/([a-z0-9-]+)$/.exec(tool);
  if (m) return make("gcp", m[1], "package");
  m = /^@azure\/([a-z0-9-]+)$/.exec(tool);
  if (m) return make("azure", m[1], "package");
  m = /^google\.cloud\.([a-z0-9_]+)/.exec(tool);
  if (m) return make("gcp", m[1].replace(/_/g, "-").replace(/-v\d+.*$/, ""), "package");
  m = /^azure\.([a-z0-9_]+(?:\.[a-z0-9_]+)?)/.exec(tool);
  if (m) return make("azure", m[1].replace(/[._]/g, "-"), "package");
  m = /^aws_sdk_([a-z0-9_]+)$/.exec(tool);
  if (m) return make("aws", m[1].replace(/_/g, "-"), "package");
  m = /^google_cloud_([a-z0-9_]+)$/.exec(tool);
  if (m) return make("gcp", m[1].replace(/_/g, "-"), "package");
  m = /^azure_([a-z0-9_]+)$/.exec(tool);
  if (m) return make("azure", m[1].replace(/_/g, "-").replace(/s$/, ""), "package");

  // 2. a client constructor's literal argument
  if (tool === "boto3" || tool === "botocore" || tool === "aioboto3") {
    const svc = literal(hint.constructorArgs?.[0]);
    return make("aws", svc, svc ? "constructor" : "none");
  }
  if (tool === "aws-sdk") {
    // v2: `new AWS.S3()` — the constructor NAME is the service.
    const svc = hint.constructorArgs?.[0] && /^[A-Za-z0-9]+$/.test(hint.constructorArgs[0]) ? hint.constructorArgs[0].toLowerCase() : null;
    return make("aws", svc, svc ? "constructor" : "none");
  }

  // 3. a CLI's first argument
  const first = hint.cliArgs?.find((a) => !a.startsWith("-"));
  const word = first ? first.replace(/^["']|["']$/g, "") : null;
  if (tool === "aws") return make("aws", word && /^[a-z0-9-]+$/.test(word) ? word : null, word ? "cli" : "none");
  if (tool === "gcloud") return make("gcp", word && /^[a-z0-9-]+$/.test(word) ? word : null, word ? "cli" : "none");
  if (tool === "gsutil") return make("gcp", "storage", "cli");
  if (tool === "az") return make("azure", word && /^[a-z0-9-]+$/.test(word) ? (word === "storage" ? "storage-blob" : word) : null, word ? "cli" : "none");
  return null;
}
