/**
 * Minimal zero-dependency .env loader.
 * Node's --env-file requires the file to exist on older runtimes, so we parse
 * it ourselves and never fail when it is absent (Docker passes real env vars).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(file = '.env') {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    // Real environment variables always win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const bool = (v, d = false) =>
  v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export { bool, num };
