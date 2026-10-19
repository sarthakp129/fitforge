#!/usr/bin/env node
/**
 * Zero-downtime automated SQLite backup utility for FitForge.
 * Uses SQLite's VACUUM INTO to produce a consistent point-in-time snapshot
 * without interrupting concurrent reads or writes in WAL mode.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/config.js';
import { db } from '../src/db.js';

const MAX_BACKUPS = 14;

export function runBackup(destDir) {
  const baseDir = destDir
    ? resolve(destDir)
    : process.env.BACKUP_DIR
    ? resolve(process.env.BACKUP_DIR)
    : join(resolve(config.dataDir || './data'), 'backups');

  mkdirSync(baseDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `fitforge-backup-${stamp}.db`;
  const targetPath = join(baseDir, filename);

  // Escape single quotes for SQLite string literal
  const escapedPath = targetPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);

  if (!existsSync(targetPath)) {
    throw new Error(`Backup failed: file ${targetPath} was not created.`);
  }

  const stat = statSync(targetPath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

  // Integrity verification on the backup snapshot
  const checkDb = new DatabaseSync(targetPath);
  try {
    const row = checkDb.prepare('PRAGMA integrity_check').get();
    if (row?.integrity_check !== 'ok') {
      throw new Error(`Backup integrity check failed: ${JSON.stringify(row)}`);
    }
  } finally {
    checkDb.close();
  }

  // Prune older backups if exceeding retention ceiling
  try {
    const existing = readdirSync(baseDir)
      .filter((f) => f.startsWith('fitforge-backup-') && f.endsWith('.db'))
      .map((f) => ({ name: f, path: join(baseDir, f), time: statSync(join(baseDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (existing.length > MAX_BACKUPS) {
      const stale = existing.slice(MAX_BACKUPS);
      for (const item of stale) {
        unlinkSync(item.path);
      }
    }
  } catch (err) {
    console.warn('Note: Could not prune older backups:', err.message);
  }

  return { targetPath, filename, sizeBytes: stat.size, sizeMb };
}

// Direct CLI invocation
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || '')) {
  try {
    const res = runBackup(process.argv[2]);
    console.log(`[Backup Success] Created ${res.filename} (${res.sizeMb} MB) at ${res.targetPath}`);
    process.exit(0);
  } catch (err) {
    console.error('[Backup Error]', err.message);
    process.exit(1);
  }
}
