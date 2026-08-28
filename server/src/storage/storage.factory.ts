import { ObjectStorage } from './storage.interface.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { R2StorageProvider } from './r2-storage.provider.js';
import { MirroredStorageProvider } from './mirrored-storage.provider.js';

export interface StorageFactoryConfig {
  STORAGE_PROVIDER?: 'LOCAL' | 'R2' | 'R2_MIRRORED';
  STORAGE_PATH: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_BASE_URL?: string;
}

export class StorageFactory {
  static createStorage(config: StorageFactoryConfig): ObjectStorage {
    const provider = config.STORAGE_PROVIDER || 'LOCAL';

    if (provider === 'LOCAL') {
      return new LocalStorageProvider(config.STORAGE_PATH, config.R2_PUBLIC_BASE_URL || '/media');
    }

    if (provider === 'R2' || provider === 'R2_MIRRORED') {
      if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET) {
        throw new Error(
          `Cấu hình chế độ lưu trữ '${provider}' không hợp lệ: Thiếu các biến môi trường R2 bắt buộc (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET). Ứng dụng từ chối khởi động (Fail Closed).`
        );
      }

      const r2Provider = new R2StorageProvider({
        accountId: config.R2_ACCOUNT_ID,
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        bucket: config.R2_BUCKET,
        publicBaseUrl: config.R2_PUBLIC_BASE_URL || '/media',
      });

      if (provider === 'R2') {
        return r2Provider;
      }

      const localMirror = new LocalStorageProvider(config.STORAGE_PATH, config.R2_PUBLIC_BASE_URL || '/media');
      return new MirroredStorageProvider(r2Provider, localMirror);
    }

    throw new Error(`Nhà cung cấp lưu trữ '${provider}' không được hỗ trợ.`);
  }
}
