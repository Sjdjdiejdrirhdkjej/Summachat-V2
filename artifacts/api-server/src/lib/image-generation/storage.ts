import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export type ImageStorageBackend = "local";

export interface ImageStorageWriteResult {
  storageBackend: ImageStorageBackend;
  storageKey: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
}

export type ImageStorageReadResult =
  | {
      status: "ok";
      storageBackend: ImageStorageBackend;
      storageKey: string;
      stream: Readable;
      byteSize: number;
      mimeType: string;
    }
  | {
      status: "not_found";
      storageBackend: ImageStorageBackend;
      storageKey: string;
    };

export interface ImageStorage {
  write(
    imageId: string,
    bytes: Uint8Array,
    mimeType?: string,
  ): Promise<ImageStorageWriteResult>;
  readStream(imageId: string): Promise<ImageStorageReadResult>;
  exists(imageId: string): Promise<boolean>;
  remove(imageId: string): Promise<void>;
}

const STORAGE_BACKEND: ImageStorageBackend = "local";
const DEFAULT_STORAGE_DIR = path.resolve(
  process.cwd(),
  ".data/generated-images",
);

function normalizeStorageDir(storageDir?: string): string {
  return path.resolve(
    storageDir ?? process.env.IMAGE_STORAGE_DIR ?? DEFAULT_STORAGE_DIR,
  );
}

function normalizeImageId(imageId: string): string {
  if (!imageId || imageId.trim().length === 0) {
    throw new Error("Image id is required");
  }

  if (
    imageId.includes(path.sep) ||
    imageId.includes("/") ||
    imageId.includes("\\") ||
    imageId.includes("..")
  ) {
    throw new Error("Invalid image id");
  }

  return imageId;
}

function toStorageKey(imageId: string): string {
  return `${normalizeImageId(imageId)}.png`;
}

function toStoragePath(storageDir: string, storageKey: string): string {
  return path.join(storageDir, storageKey);
}

function toSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function missingFileResult(storageKey: string): ImageStorageReadResult {
  return {
    status: "not_found",
    storageBackend: STORAGE_BACKEND,
    storageKey,
  };
}

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly storageDir: string = normalizeStorageDir()) {}

  async write(
    imageId: string,
    bytes: Uint8Array,
    mimeType: string = "image/png",
  ): Promise<ImageStorageWriteResult> {
    const storageKey = toStorageKey(imageId);
    const storagePath = toStoragePath(this.storageDir, storageKey);

    await mkdir(this.storageDir, { recursive: true });
    await writeFile(storagePath, bytes);

    return {
      storageBackend: STORAGE_BACKEND,
      storageKey,
      byteSize: bytes.byteLength,
      sha256: toSha256(bytes),
      mimeType,
    };
  }

  async readStream(imageId: string): Promise<ImageStorageReadResult> {
    const storageKey = toStorageKey(imageId);
    const storagePath = toStoragePath(this.storageDir, storageKey);

    try {
      const metadata = await stat(storagePath);
      return {
        status: "ok",
        storageBackend: STORAGE_BACKEND,
        storageKey,
        stream: fs.createReadStream(storagePath),
        byteSize: metadata.size,
        mimeType: "image/png",
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return missingFileResult(storageKey);
      }

      throw new Error("Failed to read image from local storage");
    }
  }

  async exists(imageId: string): Promise<boolean> {
    const storageKey = toStorageKey(imageId);
    const storagePath = toStoragePath(this.storageDir, storageKey);

    try {
      await stat(storagePath);
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }

      throw new Error("Failed to check image storage");
    }
  }

  async remove(imageId: string): Promise<void> {
    const storageKey = toStorageKey(imageId);
    const storagePath = toStoragePath(this.storageDir, storageKey);

    try {
      await rm(storagePath);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }

      throw new Error("Failed to remove image from local storage");
    }
  }
}

export function getImageStorage(storageDir?: string): ImageStorage {
  return new LocalImageStorage(normalizeStorageDir(storageDir));
}
