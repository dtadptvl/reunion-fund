import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import {
  ObjectStorage,
  StorageMetadata,
  StoredObject,
  StoredObjectHeader,
} from './storage.interface.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

export class R2StorageProvider implements ObjectStorage {
  readonly providerName = 'R2';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: R2Config, clientOverride?: S3Client) {
    if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
      throw new Error('Thiếu thông tin cấu hình Cloudflare R2 bắt buộc (accountId, accessKeyId, secretAccessKey, bucket).');
    }

    this.bucket = config.bucket;
    this.publicBaseUrl = (config.publicBaseUrl || '/media').replace(/\/+$/, '');

    this.client =
      clientOverride ||
      new S3Client({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  getBucket(): string {
    return this.bucket;
  }

  validateKey(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Khóa lưu trữ R2 không hợp lệ.');
    }
    if (key.includes('\0') || key.includes('\\') || key.includes('..')) {
      throw new Error('Khóa lưu trữ R2 chứa ký tự nguy hiểm hoặc path traversal.');
    }
    return key.replace(/^\/+/, '');
  }

  async put(key: string, data: Buffer, metadata?: StorageMetadata): Promise<void> {
    const validKey = this.validateKey(key);
    const calculatedSha256 = crypto.createHash('sha256').update(data).digest('hex');
    const finalSha256 = metadata?.sha256 || calculatedSha256;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: validKey,
      Body: data,
      ContentType: metadata?.contentType || this.guessContentType(validKey),
      ContentDisposition: metadata?.contentDisposition || 'inline',
      Metadata: {
        sha256: finalSha256,
        ...(metadata?.customMetadata || {}),
      },
    });

    await this.client.send(command);
  }

  async get(key: string): Promise<StoredObject | null> {
    const validKey = this.validateKey(key);
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: validKey,
      });

      const response = await this.client.send(command);
      if (!response.Body) return null;

      const byteArray = await response.Body.transformToByteArray();
      const body = Buffer.from(byteArray);

      return {
        key: validKey,
        size: response.ContentLength || body.length,
        contentType: response.ContentType || this.guessContentType(validKey),
        contentDisposition: response.ContentDisposition || 'inline',
        sha256: response.Metadata?.sha256,
        etag: response.ETag,
        lastModified: response.LastModified,
        customMetadata: response.Metadata,
        body,
      };
    } catch (err: any) {
      if (err instanceof NoSuchKey || err instanceof NotFound || err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getStream(key: string): Promise<{ stream: Readable; header: StoredObjectHeader } | null> {
    const validKey = this.validateKey(key);
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: validKey,
      });

      const response = await this.client.send(command);
      if (!response.Body) return null;

      const header: StoredObjectHeader = {
        key: validKey,
        size: response.ContentLength || 0,
        contentType: response.ContentType || this.guessContentType(validKey),
        contentDisposition: response.ContentDisposition || 'inline',
        sha256: response.Metadata?.sha256,
        etag: response.ETag,
        lastModified: response.LastModified,
        customMetadata: response.Metadata,
      };

      return {
        stream: response.Body as Readable,
        header,
      };
    } catch (err: any) {
      if (err instanceof NoSuchKey || err instanceof NotFound || err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async head(key: string): Promise<StoredObjectHeader | null> {
    const validKey = this.validateKey(key);
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: validKey,
      });

      const response = await this.client.send(command);
      return {
        key: validKey,
        size: response.ContentLength || 0,
        contentType: response.ContentType || this.guessContentType(validKey),
        contentDisposition: response.ContentDisposition || 'inline',
        sha256: response.Metadata?.sha256,
        etag: response.ETag,
        lastModified: response.LastModified,
        customMetadata: response.Metadata,
      };
    } catch (err: any) {
      if (err instanceof NoSuchKey || err instanceof NotFound || err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const validKey = this.validateKey(key);
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: validKey,
      });
      await this.client.send(command);
    } catch (err: any) {
      if (err instanceof NoSuchKey || err instanceof NotFound || err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return;
      }
      throw err;
    }
  }

  getPublicUrl(key: string): string {
    const cleanKey = this.validateKey(key);
    return `${this.publicBaseUrl}/${cleanKey}`;
  }

  private guessContentType(key: string): string {
    const ext = path.extname(key).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.pdf':
        return 'application/pdf';
      case '.mp3':
        return 'audio/mpeg';
      case '.m4a':
        return 'audio/mp4';
      case '.ogg':
        return 'audio/ogg';
      default:
        return 'application/octet-stream';
    }
  }
}
