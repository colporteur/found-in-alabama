// Cloudflare R2 photo storage (Phase LIST-1).
//
// Listing photos live in one R2 bucket, served publicly from a custom domain
// (R2_PUBLIC_BASE, e.g. https://photos.foundinalabama.com) so eBay and the
// storefronts can fetch them. R2 speaks the S3 API, so the AWS SDK is used
// with R2's endpoint.
//
// Env (set in Vercel, never in the repo):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   R2_PUBLIC_BASE
//
// Two upload paths:
//   - the PC sender (PhotoXfer) gets short-lived presigned PUT URLs and
//     uploads straight to R2, so big scans never pass through Vercel
//     (4.5 MB request limit) and no bucket CORS rule is needed
//   - the manual lister in the browser downsizes photos client-side and
//     posts them to an API route, which writes them with putObject

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

export function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const publicBase = process.env.R2_PUBLIC_BASE?.trim().replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase };
}

let cached: { key: string; client: S3Client } | null = null;

function client(cfg: R2Config): S3Client {
  const key = `${cfg.accountId}:${cfg.accessKeyId}`;
  if (cached?.key === key) return cached.client;
  const c = new S3Client({
    region: "auto",
    forcePathStyle: true,
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Newer SDKs add a CRC32 of the (empty) body to presigned PUT URLs,
    // which makes R2 reject the real upload. Only checksum when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { key, client: c };
  return c;
}

export function publicUrl(cfg: R2Config, key: string): string {
  return `${cfg.publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Presigned PUT URL valid for `expiresIn` seconds. The uploader must send
 *  the same Content-Type header. */
export async function presignPut(
  cfg: R2Config,
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    client(cfg),
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

export async function putObject(
  cfg: R2Config,
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  await client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

/** Size in bytes if the object exists, else null. */
export async function headObject(cfg: R2Config, key: string): Promise<number | null> {
  try {
    const res = await client(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return res.ContentLength ?? 0;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err as Error).name === "NotFound") return null;
    throw err;
  }
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif",
  "image/heic": "heic",
};

export const ALLOWED_PHOTO_TYPES = new Set(Object.keys(EXT));

/** Object key for a draft photo: drafts/<draftId>/<NN>-<sha8>.<ext>.
 *  Content-addressed by hash so a re-send of the same file is idempotent. */
export function draftPhotoKey(draftId: string, position: number, sha256: string, contentType: string): string {
  const ext = EXT[contentType] ?? "jpg";
  return `drafts/${draftId}/${String(position).padStart(2, "0")}-${sha256.slice(0, 12)}.${ext}`;
}
