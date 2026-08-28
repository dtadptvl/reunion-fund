import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  LocalStorageProvider,
  R2StorageProvider,
  MirroredStorageProvider,
  StorageFactory,
  ObjectStorage,
} from '../../server/src/storage/index.js';

describe('Storage Abstraction Layer: Unit Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_storage_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('LocalStorageProvider', () => {
    it('successfully puts, heads, gets, and deletes objects', async () => {
      const storage = new LocalStorageProvider(tempDir, '/media');
      const data = Buffer.from('Hello Local Storage!');
      const key = 'receipts/exp_123_abc.jpg';

      // 1. Put
      await storage.put(key, data, {
        contentType: 'image/jpeg',
        contentDisposition: 'inline; filename="receipt.jpg"',
      });

      // Verify file exists on disk
      const filePath = path.join(tempDir, 'receipts', 'exp_123_abc.jpg');
      expect(fs.existsSync(filePath)).toBe(true);

      // 2. Head
      const header = await storage.head(key);
      expect(header).not.toBeNull();
      expect(header?.size).toBe(data.length);
      expect(header?.contentType).toBe('image/jpeg');
      expect(header?.sha256).toBe(crypto.createHash('sha256').update(data).digest('hex'));

      // 3. Get
      const obj = await storage.get(key);
      expect(obj).not.toBeNull();
      expect(obj?.body.toString()).toBe('Hello Local Storage!');
      expect(obj?.contentType).toBe('image/jpeg');

      // 4. GetStream
      const streamObj = await storage.getStream(key);
      expect(streamObj).not.toBeNull();
      const chunks: Buffer[] = [];
      for await (const chunk of streamObj!.stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('Hello Local Storage!');

      // 5. Public URL
      expect(storage.getPublicUrl(key)).toBe('/media/receipts/exp_123_abc.jpg');

      // 6. Delete
      await storage.delete(key);
      expect(fs.existsSync(filePath)).toBe(false);

      // Subsequent get/head returns null
      expect(await storage.get(key)).toBeNull();
      expect(await storage.head(key)).toBeNull();

      // Idempotent delete does not throw
      await expect(storage.delete(key)).resolves.not.toThrow();
    });

    it('rejects path traversal attempts strictly', async () => {
      const storage = new LocalStorageProvider(tempDir);
      const data = Buffer.from('Malicious Data');

      // Traversal using ..
      await expect(storage.put('../../etc/passwd', data)).rejects.toThrow();
      await expect(storage.get('../secret.txt')).rejects.toThrow();
      await expect(storage.head('sub/../../outside')).rejects.toThrow();
      await expect(storage.delete('../outside')).rejects.toThrow();

      // Backslash / null byte rejection
      await expect(storage.put('receipts\\malicious.jpg', data)).rejects.toThrow();
      await expect(storage.put('receipts/\0malicious.jpg', data)).rejects.toThrow();
    });
  });

  describe('R2StorageProvider (Mocked Client)', () => {
    it('validates configuration and fails if required parameters are missing', () => {
      expect(() => {
        new R2StorageProvider({
          accountId: '',
          accessKeyId: 'key',
          secretAccessKey: 'sec',
          bucket: 'b',
        });
      }).toThrow('Thiếu thông tin cấu hình Cloudflare R2 bắt buộc');
    });

    it('performs put, get, head, delete via S3Client interface', async () => {
      const memoryStore = new Map<string, { body: Buffer; metadata: any }>();

      const fakeS3Client: any = {
        send: async (command: any) => {
          const name = command.constructor.name;
          const input = command.input;

          if (name === 'PutObjectCommand') {
            memoryStore.set(input.Key, {
              body: input.Body,
              metadata: {
                contentType: input.ContentType,
                contentDisposition: input.ContentDisposition,
                sha256: input.Metadata?.sha256,
              },
            });
            return {};
          }

          if (name === 'GetObjectCommand') {
            const item = memoryStore.get(input.Key);
            if (!item) {
              const err: any = new Error('NoSuchKey');
              err.name = 'NoSuchKey';
              throw err;
            }
            return {
              Body: {
                transformToByteArray: async () => new Uint8Array(item.body),
              },
              ContentLength: item.body.length,
              ContentType: item.metadata.contentType,
              ContentDisposition: item.metadata.contentDisposition,
              Metadata: { sha256: item.metadata.sha256 },
              ETag: '"test-etag"',
              LastModified: new Date(),
            };
          }

          if (name === 'HeadObjectCommand') {
            const item = memoryStore.get(input.Key);
            if (!item) {
              const err: any = new Error('NotFound');
              err.name = 'NotFound';
              throw err;
            }
            return {
              ContentLength: item.body.length,
              ContentType: item.metadata.contentType,
              ContentDisposition: item.metadata.contentDisposition,
              Metadata: { sha256: item.metadata.sha256 },
              ETag: '"test-etag"',
              LastModified: new Date(),
            };
          }

          if (name === 'DeleteObjectCommand') {
            memoryStore.delete(input.Key);
            return {};
          }

          throw new Error(`Unsupported command ${name}`);
        },
      };

      const r2 = new R2StorageProvider(
        {
          accountId: 'test-account',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          bucket: 'reunion-fund-stage-media',
        },
        fakeS3Client
      );

      const key = 'receipts/test-r2-1.png';
      const data = Buffer.from('R2 Object Content');

      // 1. Put
      await r2.put(key, data, { contentType: 'image/png' });
      expect(memoryStore.has(key)).toBe(true);

      // 2. Head
      const head = await r2.head(key);
      expect(head).not.toBeNull();
      expect(head?.size).toBe(data.length);
      expect(head?.contentType).toBe('image/png');

      // 3. Get
      const getObj = await r2.get(key);
      expect(getObj).not.toBeNull();
      expect(getObj?.body.toString()).toBe('R2 Object Content');

      // 4. Public URL
      expect(r2.getPublicUrl(key)).toBe('/media/receipts/test-r2-1.png');

      // 5. Delete
      await r2.delete(key);
      expect(memoryStore.has(key)).toBe(false);
      expect(await r2.get(key)).toBeNull();
      expect(await r2.head(key)).toBeNull();
    });

    it('rejects traversal keys in R2StorageProvider', async () => {
      const r2 = new R2StorageProvider(
        {
          accountId: 'acc',
          accessKeyId: 'key',
          secretAccessKey: 'sec',
          bucket: 'b',
        },
        {} as any
      );

      await expect(r2.put('../invalid', Buffer.from('x'))).rejects.toThrow('path traversal');
      await expect(r2.get('receipts\\invalid')).rejects.toThrow('path traversal');
    });
  });

  describe('MirroredStorageProvider', () => {
    it('writes to both primary and mirror on put, and deletes from both on delete', async () => {
      const localPrimary = new LocalStorageProvider(path.join(tempDir, 'primary'));
      const localMirror = new LocalStorageProvider(path.join(tempDir, 'mirror'));
      const mirrored = new MirroredStorageProvider(localPrimary, localMirror);

      const key = 'receipts/mirrored_receipt.jpg';
      const data = Buffer.from('Mirrored Content');

      // Put
      await mirrored.put(key, data, { contentType: 'image/jpeg' });

      // Check both primary and mirror have the object
      const primaryGet = await localPrimary.get(key);
      const mirrorGet = await localMirror.get(key);
      expect(primaryGet).not.toBeNull();
      expect(mirrorGet).not.toBeNull();
      expect(primaryGet?.body.toString()).toBe('Mirrored Content');
      expect(mirrorGet?.body.toString()).toBe('Mirrored Content');

      // Delete
      await mirrored.delete(key);
      expect(await localPrimary.get(key)).toBeNull();
      expect(await localMirror.get(key)).toBeNull();
    });
  });

  describe('StorageFactory', () => {
    it('creates LocalStorageProvider when STORAGE_PROVIDER=LOCAL', () => {
      const storage = StorageFactory.createStorage({
        STORAGE_PROVIDER: 'LOCAL',
        STORAGE_PATH: tempDir,
      });
      expect(storage.providerName).toBe('LOCAL');
    });

    it('fails closed when STORAGE_PROVIDER=R2 or R2_MIRRORED without R2 credentials', () => {
      expect(() => {
        StorageFactory.createStorage({
          STORAGE_PROVIDER: 'R2',
          STORAGE_PATH: tempDir,
        });
      }).toThrow('Cấu hình chế độ lưu trữ \'R2\' không hợp lệ: Thiếu các biến môi trường R2 bắt buộc');

      expect(() => {
        StorageFactory.createStorage({
          STORAGE_PROVIDER: 'R2_MIRRORED',
          STORAGE_PATH: tempDir,
        });
      }).toThrow('Cấu hình chế độ lưu trữ \'R2_MIRRORED\' không hợp lệ: Thiếu các biến môi trường R2 bắt buộc');
    });

    it('creates R2 / Mirrored storage when credentials are fully provided', () => {
      const storage = StorageFactory.createStorage({
        STORAGE_PROVIDER: 'R2_MIRRORED',
        STORAGE_PATH: tempDir,
        R2_ACCOUNT_ID: 'acc123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret123',
        R2_BUCKET: 'reunion-fund-stage-media',
      });
      expect(storage.providerName).toBe('R2_MIRRORED');
    });
  });

  describe('MirroredStorageProvider Fail-Closed (B5)', () => {
    it('fails closed when local mirror write fails on put', async () => {
      const primary = new LocalStorageProvider(path.join(tempDir, 'primary'));
      const failingMirror: ObjectStorage = {
        providerName: 'LOCAL',
        put: async () => {
          throw new Error('mirror disk full');
        },
        get: async () => null,
        getStream: async () => null,
        head: async () => null,
        delete: async () => {},
        getPublicUrl: (k) => `/media/${k}`,
      };

      const mirrored = new MirroredStorageProvider(primary, failingMirror);
      await expect(mirrored.put('receipts/mirror_fail.jpg', Buffer.from('data'))).rejects.toThrow('mirror disk full');
    });

    it('mirror delete failure remains warn-only and does not fail the delete', async () => {
      const primary = new LocalStorageProvider(path.join(tempDir, 'primary'));
      const fragileMirror: ObjectStorage = {
        providerName: 'LOCAL',
        put: async () => {},
        get: async () => null,
        getStream: async () => null,
        head: async () => null,
        delete: async () => {
          throw new Error('mirror delete denied');
        },
        getPublicUrl: (k) => `/media/${k}`,
      };

      const mirrored = new MirroredStorageProvider(primary, fragileMirror);
      await mirrored.put('receipts/delete_ok.jpg', Buffer.from('data'));
      await expect(mirrored.delete('receipts/delete_ok.jpg')).resolves.toBeUndefined();
    });
  });
});
