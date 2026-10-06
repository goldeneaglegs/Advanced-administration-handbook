import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '@/env';

/**
 * S3-compatible private object storage (Phase 1 §5).
 *
 * The bucket is private: there is no public read policy and no public ACL, and
 * nothing in this module can create one. Documents are reached only through
 * short-lived signed URLs issued after an authorisation check — that flow
 * arrives in Milestone 5; this module currently provides the client and the
 * health probe only.
 */
const globalForS3 = globalThis as unknown as { s3?: S3Client };

export function getStorage(): S3Client {
  if (!globalForS3.s3) {
    const env = getEnv();
    globalForS3.s3 = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }
  return globalForS3.s3;
}

/** True when the configured bucket exists and our credentials can see it. */
export async function checkStorage(): Promise<boolean> {
  try {
    await getStorage().send(new HeadBucketCommand({ Bucket: getEnv().STORAGE_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
