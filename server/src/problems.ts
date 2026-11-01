import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth/index.js';
import { db } from './db.js';

const KEEP = 500;

/**
 * Remembers what went wrong, for Settings → Problems. Survives restarts, and never gets in the way
 * of the thing that failed.
 */
export function logProblem(source: string, err: unknown, detail?: string) {
  const e = err as Error & { raw?: string };
  const message = e?.message ?? String(err);
  const text = [detail, e?.raw && `What the AI answered:\n${e.raw}`, e?.stack].filter(Boolean).join('\n\n');
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO problems (source, message, detail) VALUES (?, ?, ?)').run(source, message.slice(0, 2000), text.slice(0, 20_000) || null);
    db.prepare('DELETE FROM problems WHERE id <= ?').run(Number(lastInsertRowid) - KEEP);
  } catch (dbErr) {
    console.error('Could not log a problem:', dbErr);
  }
}

export function problemRoutes(app: FastifyInstance) {
  app.get('/api/problems', { preHandler: requireAdmin }, async () => db.prepare('SELECT id, at, source, message, detail FROM problems ORDER BY id DESC LIMIT 200').all());
  app.delete('/api/problems', { preHandler: requireAdmin }, async () => {
    db.prepare('DELETE FROM problems').run();
    return { ok: true };
  });
}
