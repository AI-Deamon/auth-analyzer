// Copies the shared, tested core/ and ui/ into the extension so it can be loaded unpacked from ./extension
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
rmSync(path.join(root, 'extension', 'lib'), { recursive: true, force: true }); // old build output
for (const dir of ['core', 'ui']) {
  const dest = path.join(root, 'extension', dir);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(root, dir), dest, { recursive: true });
}
console.log('Copied core/ and ui/ to extension/');
