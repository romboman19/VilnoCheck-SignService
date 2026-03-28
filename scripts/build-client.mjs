import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
await mkdir(path.join(root, 'public', 'assets'), { recursive: true });
await copyFile(path.join(root, 'src', 'client', 'main.js'), path.join(root, 'public', 'assets', 'app.js'));
