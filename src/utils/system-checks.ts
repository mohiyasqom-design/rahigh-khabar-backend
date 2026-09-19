/**
 * Stage 10 Part 4 — real service checks for /health and the system panel.
 *
 * Each check actually does something (a query, a filesystem permission test)
 * and reports how long it took. Failure details are deliberately reduced to an
 * error class name: a raw database error can contain the connection string.
 */
import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export type CheckStatus = 'up' | 'down';

export type CheckResult = {
  status: CheckStatus;
  latencyMs: number;
  detail: string | null;
};

/** Only the part of PrismaClient a probe needs, so tests can pass a stub. */
export type DatabaseProbe = Pick<PrismaClient, '$queryRaw'>;

export async function checkDatabase(prisma: DatabaseProbe): Promise<CheckResult> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'up', latencyMs: Date.now() - started, detail: null };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

/** Uploads live on a local disk, so readable + writable is the real test. */
export async function checkStorage(): Promise<CheckResult> {
  const started = Date.now();
  try {
    await access(resolve(env.UPLOAD_DIR), constants.R_OK | constants.W_OK);
    return { status: 'up', latencyMs: Date.now() - started, detail: null };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      detail: 'پوشهٔ آپلود قابل خواندن یا نوشتن نیست',
    };
  }
}
