/**
 * Where uploaded files live and how they get there (docs/v1/TechStack.md section 5).
 * Files are named by their id, never by the uploaded name, in one folder per user.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';
}

export const userDir = (root: string, userId: string) => join(root, userId);
export const filePath = (root: string, userId: string, id: string) => join(root, userId, id);

/**
 * Streams `body` to disk and returns the number of bytes written.
 * Nothing is kept in memory. If the body is larger than `maxBytes`, or the
 * connection breaks, the partial file is deleted and the error is thrown.
 */
export async function saveUpload(
  root: string,
  userId: string,
  id: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  await mkdir(userDir(root, userId), { recursive: true });
  const finalPath = filePath(root, userId, id);
  const partPath = `${finalPath}.part`;

  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) done(new FileTooLargeError());
      else done(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream),
      counter,
      createWriteStream(partPath),
    );
    await rename(partPath, finalPath);
    return size;
  } catch (err) {
    await rm(partPath, { force: true });
    throw err;
  }
}

export async function removeFile(root: string, userId: string, id: string): Promise<void> {
  await rm(filePath(root, userId, id), { force: true });
}

export async function removeUserFiles(root: string, userId: string): Promise<void> {
  await rm(userDir(root, userId), { recursive: true, force: true });
}

export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}
