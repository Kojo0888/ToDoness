// Copies the SQL migrations next to the bundle and writes a package.json that
// lists only the native modules the bundle cannot include. A production image
// runs `npm install --omit=dev` against that file.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

cpSync('src/db/migrations', 'dist/migrations', { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const native = ['better-sqlite3', '@node-rs/argon2'];
const dependencies = Object.fromEntries(native.map((n) => [n, pkg.dependencies[n]]));
writeFileSync(
  'dist/package.json',
  JSON.stringify(
    { name: 'todoness-server', private: true, type: 'module', dependencies },
    null,
    2,
  ) + '\n',
);
console.log('postbuild: migrations copied, dist/package.json written');
