/**
 * Object storage adapter (MinIO / any S3-compatible store).
 * Stores generated images; the database keeps only URLs.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true, // required for MinIO
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

export interface StoredObject {
  key: string;
  url: string;
}

/**
 * Upload bytes and return a publicly served URL.
 * `key` should be unique, e.g. `${userId}/${postId}/${kind}.png`.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType = "image/png",
): Promise<StoredObject> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key, url: `${env.S3_PUBLIC_URL}/${key}` };
}

/** Map a stored public URL back to its object key. */
export function urlToKey(url: string): string {
  return url.startsWith(env.S3_PUBLIC_URL)
    ? url.slice(env.S3_PUBLIC_URL.length + 1)
    : url;
}

/** Fetch object bytes via the S3 API (works from inside the Docker network). */
export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Best-effort delete of a stored object (ignores missing keys). */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  } catch {
    /* ignore */
  }
}
