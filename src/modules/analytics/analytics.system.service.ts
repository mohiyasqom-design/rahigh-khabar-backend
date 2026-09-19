/**
 * Stage 10 Part 4 — system status panel.
 *
 * Two things in the brief cannot be answered from inside the application, and
 * both are reported honestly instead of being invented:
 *
 *  - Last backup: Railway's managed PostgreSQL backups are not exposed through
 *    an API reachable from the app. If an operator publishes the timestamp in
 *    DB_BACKUP_LAST_AT it is shown; otherwise the panel says
 *    «نامشخص — نیاز به تنظیم دستی».
 *  - Recent errors: this project has no error-log store yet, so the panel says
 *    so rather than showing an empty list that looks like "no errors".
 */
import type { PrismaClient } from '@prisma/client';
import { lastBackupAt } from '../../config/env.js';
import { checkDatabase, checkStorage, type CheckResult } from '../../utils/system-checks.js';

export const BACKUP_UNKNOWN_NOTE = 'نامشخص — نیاز به تنظیم دستی';
export const BACKUP_KNOWN_NOTE =
  'زمان اعلام‌شده توسط مدیر سیستم (DB_BACKUP_LAST_AT). Railway زمان بکاپ‌های مدیریت‌شده را به برنامه نمی‌دهد.';
export const ERROR_LOG_NOTE = 'سیستم ثبت خطا هنوز پیاده‌سازی نشده است.';

export type SystemStatus = {
  checkedAt: string;
  overall: 'ok' | 'degraded';
  services: {
    backend: CheckResult;
    database: CheckResult;
    storage: CheckResult;
    api: CheckResult;
  };
  uptimeSeconds: number;
  backup: { configured: boolean; lastAt: string | null; note: string };
  errorLog: { implemented: false; note: string; entries: [] };
};

/** Serving this request at all proves the backend and API layers are alive. */
const SELF_CHECK: CheckResult = { status: 'up', latencyMs: 0, detail: null };

export async function getSystemStatus(prisma: PrismaClient): Promise<SystemStatus> {
  const [database, storage] = await Promise.all([checkDatabase(prisma), checkStorage()]);
  const backupAt = lastBackupAt();

  return {
    checkedAt: new Date().toISOString(),
    overall: database.status === 'up' && storage.status === 'up' ? 'ok' : 'degraded',
    services: { backend: SELF_CHECK, database, storage, api: SELF_CHECK },
    uptimeSeconds: Math.floor(process.uptime()),
    backup: {
      configured: backupAt !== null,
      lastAt: backupAt === null ? null : backupAt.toISOString(),
      note: backupAt === null ? BACKUP_UNKNOWN_NOTE : BACKUP_KNOWN_NOTE,
    },
    errorLog: { implemented: false, note: ERROR_LOG_NOTE, entries: [] },
  };
}
