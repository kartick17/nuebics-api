import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import catalyst from 'zcatalyst-sdk-node';
import type { Env } from '../../config/env.validation';

@Injectable()
export class StratusService {
  private readonly bucket: ReturnType<
    ReturnType<ReturnType<typeof catalyst.initializeApp>['stratus']>['bucket']
  >;

  constructor(config: ConfigService<Env, true>) {
    const credential = catalyst.credential.refreshToken({
      client_id: config.get('ZOHO_CLIENT_ID', { infer: true }),
      client_secret: config.get('ZOHO_CLIENT_SECRET', { infer: true }),
      refresh_token: config.get('ZOHO_REFRESH_TOKEN', { infer: true })
    });

    const app = catalyst.initializeApp({
      project_id: config.get('ZOHO_PROJECT_ID', { infer: true }),
      project_key: config.get('ZOHO_PROJECT_KEY', { infer: true }),
      environment: config.get('ZOHO_ENVIRONMENT', { infer: true }),
      credential
    });

    this.bucket = app
      .stratus()
      .bucket(config.get('ZOHO_BUCKET_NAME', { infer: true }));
  }

  async presignPut(
    key: string,
    _contentType: string,
    expiresIn = 300
  ): Promise<string> {
    const res = await this.bucket.generatePreSignedUrl(key, 'PUT', {
      expiryIn: String(expiresIn)
    });
    if (!res?.signature) throw new Error('Stratus did not return a signed URL');
    return res.signature;
  }

  async presignGet(key: string, expiresIn = 300): Promise<string> {
    const res = await this.bucket.generatePreSignedUrl(key, 'GET', {
      expiryIn: String(expiresIn)
    });
    if (!res?.signature) throw new Error('Stratus did not return a signed URL');
    return res.signature;
  }

  async head(
    key: string
  ): Promise<{ ContentLength: number; ContentType: string }> {
    const details = await this.bucket.object(key).getDetails();
    return {
      ContentLength: Number(details.size),
      ContentType: details.content_type
    };
  }

  deleteOne(key: string) {
    return this.bucket.deleteObject(key);
  }

  async deleteMany(keys: string[]) {
    if (keys.length === 0) return;
    const BATCH = 1000;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      await this.bucket.deleteObjects(chunk.map((key) => ({ key })));
    }
  }
}
