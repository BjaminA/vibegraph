import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PubSub } from "@google-cloud/pubsub";
import { BlobServiceClient } from "@azure/storage-blob";

// Stores an upload in S3, announces it on Pub/Sub, mirrors it to Azure.
export async function POST(req: Request) {
  const body = await req.text();
  const s3 = new S3Client({ region: "eu-west-2" });
  await s3.send(new PutObjectCommand({ Bucket: "uploads", Key: "latest.json", Body: body }));
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: "uploads", Key: "latest.json" }), { expiresIn: 600 });
  const pubsub = new PubSub();
  await pubsub.topic("uploads").publishMessage({ data: Buffer.from(url) });
  const blobs = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE ?? "");
  await blobs.getContainerClient("mirror").uploadBlockBlob("latest.json", body, body.length);
  return new Response(url);
}
