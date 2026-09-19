import type { NewsStatus, Prisma } from '@prisma/client';
import type { PublicUser } from '../users/index.js';
import { ApiError } from '../../utils/api-error.js';
export type NewsActor = Pick<PublicUser, 'id' | 'role'>;
export function requireActor(actor: PublicUser | null): NewsActor {
  if (!actor) throw new ApiError(401, 'UNAUTHORIZED', 'احراز هویت لازم است.');
  return actor;
}
// SCHEDULED articles stay editable: they have not been published yet.
const editableStatuses: readonly NewsStatus[] = ['DRAFT', 'IN_REVIEW', 'REJECTED', 'SCHEDULED'];
export const newsPolicy = {
  scope(actor: NewsActor): Prisma.NewsWhereInput {
    return actor.role === 'SUPER_ADMIN' ? {} : { authorId: actor.id };
  },
  assert(actor: NewsActor, news: { authorId: string; status: NewsStatus }, action: 'read' | 'edit' | 'delete' | 'status'): void {
    if (actor.role === 'SUPER_ADMIN') return;
    if (action === 'delete' || action === 'status' || news.authorId !== actor.id ||
        (action === 'edit' && !editableStatuses.includes(news.status))) {
      throw new ApiError(403, 'FORBIDDEN', 'اجازهٔ انجام این عملیات روی این خبر را ندارید.');
    }
  },
};
// Explicitly allow review submission by Super Admin, plus archived re-publication.
// Same-state requests are not transitions and are rejected.
export const allowedTransitions: Readonly<Record<NewsStatus, readonly NewsStatus[]>> = {
  DRAFT: ['IN_REVIEW', 'PUBLISHED', 'SCHEDULED', 'REJECTED', 'ARCHIVED'],
  IN_REVIEW: ['PUBLISHED', 'SCHEDULED', 'REJECTED', 'ARCHIVED'],
  // Stage 10 Part 5: a queued article can be published early, pulled back to a
  // draft, rejected or archived; the scheduler itself moves it to PUBLISHED.
  SCHEDULED: ['PUBLISHED', 'DRAFT', 'REJECTED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'SCHEDULED'],
  ARCHIVED: ['PUBLISHED'],
};
export function assertTransition(from: NewsStatus, to: NewsStatus): void {
  const allowed = allowedTransitions[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError(400, 'INVALID_STATUS_TRANSITION',
      `انتقال از ${from} به ${to} مجاز نیست. وضعیت‌های مجاز: ${allowed.join(', ')}`);
  }
}
