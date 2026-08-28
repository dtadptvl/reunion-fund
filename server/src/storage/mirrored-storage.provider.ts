import { Readable } from 'stream';
import {
  ObjectStorage,
  StorageMetadata,
  StoredObject,
  StoredObjectHeader,
} from './storage.interface.js';

export class MirroredStorageProvider implements ObjectStorage {
  readonly providerName = 'R2_MIRRORED';

  constructor(
    private readonly primary: ObjectStorage,
    private readonly mirror: ObjectStorage
  ) {}

  getPrimary(): ObjectStorage {
    return this.primary;
  }

  getMirror(): ObjectStorage {
    return this.mirror;
  }

  async put(key: string, data: Buffer, metadata?: StorageMetadata): Promise<void> {
    // 1. Primary write (R2)
    await this.primary.put(key, data, metadata);

    // 2. Local mirror write — FAIL-CLOSED.
    // H2 contract requires a local mirror for every new write (lossless rollback).
    // A mirror write failure must fail the whole put; it must never degrade silently.
    try {
      await this.mirror.put(key, data, metadata);
    } catch (err) {
      console.error(`[MirroredStorageProvider] Fail-closed: local mirror write failed for key ${key}:`, err);
      throw err;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const obj = await this.primary.get(key);
      if (obj) return obj;
    } catch (err) {
      console.warn(`[MirroredStorageProvider] Primary get failed for key ${key}, trying mirror:`, err);
    }

    return this.mirror.get(key);
  }

  async getStream(key: string): Promise<{ stream: Readable; header: StoredObjectHeader } | null> {
    try {
      const obj = await this.primary.getStream(key);
      if (obj) return obj;
    } catch (err) {
      console.warn(`[MirroredStorageProvider] Primary getStream failed for key ${key}, trying mirror:`, err);
    }

    return this.mirror.getStream(key);
  }

  async head(key: string): Promise<StoredObjectHeader | null> {
    try {
      const header = await this.primary.head(key);
      if (header) return header;
    } catch (err) {
      console.warn(`[MirroredStorageProvider] Primary head failed for key ${key}, trying mirror:`, err);
    }

    return this.mirror.head(key);
  }

  async delete(key: string): Promise<void> {
    // Delete intentionally from both R2 and local mirror
    let primaryErr: any = null;
    let mirrorErr: any = null;

    try {
      await this.primary.delete(key);
    } catch (err) {
      primaryErr = err;
    }

    try {
      await this.mirror.delete(key);
    } catch (err) {
      mirrorErr = err;
    }

    if (primaryErr) {
      throw primaryErr;
    }
    if (mirrorErr) {
      console.warn(`[MirroredStorageProvider] Warning: Failed to delete mirror for key ${key}:`, mirrorErr);
    }
  }

  getPublicUrl(key: string): string {
    return this.primary.getPublicUrl(key);
  }
}
