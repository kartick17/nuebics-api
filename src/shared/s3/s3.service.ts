import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.validation';

@Injectable()
export class S3Service {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.client = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.bucket = config.get('AWS_S3_BUCKET_NAME', { infer: true });
  }

  presignPut(key: string, contentType: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  presignGet(key: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  head(key: string): Promise<HeadObjectCommandOutput> {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  deleteOne(key: string) {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]) {
    if (keys.length === 0) return;
    const BATCH = 1000;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: k })), Quiet: true },
        }),
      );
    }
  }
}
