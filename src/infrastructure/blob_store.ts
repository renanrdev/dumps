// infrastructure/blob_store.ts — R2 adapter implementing the BlobStore port.

export interface BlobStore {
  put(key: string, value: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * R2BlobStore — adapter over Cloudflare R2Bucket binding.
 */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, value: Uint8Array): Promise<void> {
    await this.bucket.put(key, value, {
      httpMetadata: {
        contentType: "text/plain; charset=utf-8",
      },
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (obj === null) return null;
    const buf = await obj.arrayBuffer();
    return new Uint8Array(buf);
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
