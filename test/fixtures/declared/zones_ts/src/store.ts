// The client and the bucket ports.
import { S3Client } from "@aws-sdk/client-s3";
import { settings } from "./config.ts";
import { bucketFor } from "./catalogue.ts";

/** A client signed in with one identity's config. */
export function connect(configPath: string): S3Client {
  return new S3Client({ profile: configPath });
}

/** What the logic needs from a bucket. */
export interface Bucket {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string>;
  label?: string;
}

/** An in-memory bucket: it never says `implements Bucket`. */
export class MemoryBucket {
  private data = new Map<string, string>();
  async put(key: string, body: string): Promise<void> { this.data.set(key, body); }
  async get(key: string): Promise<string> { return this.data.get(key) ?? ""; }
}

export function bucketName(zone: string): string {
  return bucketFor(settings.prefix, zone);
}

export async function save(b: Bucket, key: string, body: string): Promise<void> {
  await b.put(key, body);
}
