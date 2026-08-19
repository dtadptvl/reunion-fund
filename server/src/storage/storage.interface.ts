import { Readable } from 'stream';

export interface StorageMetadata {
  contentType?: string;
  contentDisposition?: string;
  sha256?: string;
  customMetadata?: Record<string, string>;
}

export interface StoredObjectHeader {
  key: string;
  size: number;
  contentType?: string;
  contentDisposition?: string;
  sha256?: string;
  etag?: string;
  lastModified?: Date;
  customMetadata?: Record<string, string>;
}

export interface StoredObject extends StoredObjectHeader {
  body: Buffer;
}

export interface ObjectStorage {
  /**
   * Writes data buffer to storage under key with metadata.
   */
  put(key: string, data: Buffer, metadata?: StorageMetadata): Promise<void>;

  /**
   * Retrieves full object buffer and metadata. Returns null if not found.
   */
  get(key: string): Promise<StoredObject | null>;

  /**
   * Retrieves object stream and header for large object streaming. Returns null if not found.
   */
  getStream(key: string): Promise<{ stream: Readable; header: StoredObjectHeader } | null>;

  /**
   * Checks existence and metadata of object without downloading body. Returns null if not found.
   */
  head(key: string): Promise<StoredObjectHeader | null>;

  /**
   * Deletes object at key. Idempotent (does not error if already missing).
   */
  delete(key: string): Promise<void>;

  /**
   * Returns deterministic public/client URL or path for accessing object.
   */
  getPublicUrl(key: string): string;

  /**
   * Provider identifier ('LOCAL', 'R2', 'R2_MIRRORED', 'MOCK')
   */
  readonly providerName: string;
}
