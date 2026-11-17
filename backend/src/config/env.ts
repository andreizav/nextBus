import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoEnvPath = path.resolve(__dirname, '../../../.env');

if (fs.existsSync(repoEnvPath)) {
  dotenv.config({ path: repoEnvPath });
} else {
  dotenv.config();
}
