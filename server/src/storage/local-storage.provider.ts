import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import {
  ObjectStorage,
  StorageMetadata,
  StoredObject,
  StoredObjectHeader,
} from './storage.interface.js';

export class LocalStorageProvider implements ObjectStorage {
  readonly providerName = 'LOCAL';
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  constructor(rootDir: string, publicBaseUrl = '/media') {
    this.rootDir = path.resolve(rootDir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  getRootDir(): string {
    return this.rootDir;
  }

  /**
   * Resolves a key to an absolute filesystem path, strictly rejecting path traversal attacks.
   */
  resolveSafePath(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Khóa lưu trữ không hợp lệ.');
    }

    // Check for null bytes or backslashes
    if (key.includes('\0') || key.includes('\\')) {
      throw new Error('Khóa lưu trữ chứa ký tự không hợp lệ.');
    }

    // Explicitly reject paths containing '..' or '.' segments
    const segments = key.split('/');
    if (segments.includes('..') || segments.includes('.')) {
      throw new Error('Phát hiện hành vi truy cập thư mục trái phép (Path Traversal).');
    }

    const cleanKey = key.replace(/^\/+/, '');
    const resolvedPath = path.resolve(this.rootDir, cleanKey);

    if (!resolvedPath.startsWith(this.rootDir + path.sep) && resolvedPath !== this.rootDir) {
      throw new Error('Phát hiện hành vi truy cập thư mục trái phép (Path Traversal).');
    }

    return resolvedPath;
  }

  private getMetaPath(filePath: string): string {
    return `${filePath}.meta.json`;
  }

  async put(key: string, data: Buffer, metadata?: StorageMetadata): Promise<void> {
    const targetPath = this.resolveSafePath(key);
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const calculatedSha256 = crypto.createHash('sha256').update(data).digest('hex');
    const finalSha256 = metadata?.sha256 || calculatedSha256;

    fs.writeFileSync(targetPath, data);

    const metaContent = {
      contentType: metadata?.contentType || this.guessContentType(key),
      contentDisposition: metadata?.contentDisposition || 'inline',
      sha256: finalSha256,
      customMetadata: metadata?.customMetadata || {},
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.getMetaPath(targetPath), JSON.stringify(metaContent, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[LocalStorageProvider] Failed to write sidecar metadata:', err);
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const targetPath = this.resolveSafePath(key);
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return null;
    }

    const body = fs.readFileSync(targetPath);
    const header = await this.head(key);
    if (!header) return null;

    return {
      ...header,
      body,
    };
  }

  async getStream(key: string): Promise<{ stream: Readable; header: StoredObjectHeader } | null> {
    const targetPath = this.resolveSafePath(key);
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return null;
    }

    const header = await this.head(key);
    if (!header) return null;

    const stream = fs.createReadStream(targetPath);
    return { stream, header };
  }

  async head(key: string): Promise<StoredObjectHeader | null> {
    const targetPath = this.resolveSafePath(key);
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return null;
    }

    let meta: any = null;
    const metaPath = this.getMetaPath(targetPath);
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {
        // fallback
      }
    }

    return {
      key,
      size: stat.size,
      contentType: meta?.contentType || this.guessContentType(key),
      contentDisposition: meta?.contentDisposition || 'inline',
      sha256: meta?.sha256,
      lastModified: stat.mtime,
      customMetadata: meta?.customMetadata,
    };
  }

  async delete(key: string): Promise<void> {
    const targetPath = this.resolveSafePath(key);
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    const metaPath = this.getMetaPath(targetPath);
    if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath);
      } catch {
        // ignore
      }
    }
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
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
