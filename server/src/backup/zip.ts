/** Writing a zip file with the `yazl` library: streaming, so big files never sit in memory. */
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

export interface ZipSource {
  /** Name inside the zip, with `/` as separator. */
  name: string;
  /** A file on disk, or the text to store. */
  file?: string;
  text?: string;
}

/** Writes `sources` into the zip file `target` (replaced if it exists). */
export async function writeZip(target: string, sources: readonly ZipSource[]): Promise<void> {
  const zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(target));
  for (const s of sources) {
    if (s.file !== undefined) zip.addFile(s.file, s.name);
    else zip.addBuffer(Buffer.from(s.text ?? ''), s.name);
  }
  zip.end();
  await done;
}

/**
 * Every regular file under `root` as `prefix/<relative path>`, skipping unfinished uploads
 * (`*.part`) and anything inside `skipDir` (the backup folder may lie inside `root`).
 * A missing `root` is no files.
 */
export async function listFiles(
  root: string,
  prefix: string,
  skipDir: string,
): Promise<ZipSource[]> {
  const skip = resolve(skipDir);
  const out: ZipSource[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (resolve(full) === skip || resolve(full).startsWith(skip + sep)) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && !e.name.endsWith('.part')) {
        out.push({ name: `${prefix}/${relative(root, full).split(sep).join('/')}`, file: full });
      }
    }
  }
  await walk(resolve(root));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Size in bytes, or `undefined` when the file is gone. */
export async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}
