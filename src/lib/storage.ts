import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/** Where uploaded files live. Swap the implementation for S3 or similar later. */
export interface FileStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let storage: FileStorage | null = null;

export function getStorage(): FileStorage {
  storage ??= new LocalFileStorage(env.STORAGE_DIR);
  return storage;
}

export const ACCEPTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Content-addressed per organization: the same file always lands on the same key. */
export function storageKeyFor(organizationId: string, sha256: string, mimeType: string): string {
  return `${organizationId}/${sha256}${ACCEPTED_MIME_TYPES[mimeType] ?? ""}`;
}

/** Browsers sometimes send an empty or generic type; fall back to the extension. */
export function detectMimeType(filename: string, declared: string): string | null {
  if (declared in ACCEPTED_MIME_TYPES) return declared;
  const ext = path.extname(filename).toLowerCase();
  const byExt: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return byExt[ext] ?? null;
}
