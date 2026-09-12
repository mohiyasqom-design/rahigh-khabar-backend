import test from 'node:test';
import assert from 'node:assert/strict';
import type { NewsStatus } from '@prisma/client';
import { allowedTransitions, assertTransition, newsPolicy, requireActor } from '../src/modules/news/news.policy.js';
import { ApiError } from '../src/utils/api-error.js';
const admin = { id: 'mine', role: 'ADMIN' as const };
const root = { id: 'root', role: 'SUPER_ADMIN' as const };
const statuses: NewsStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED'];
const denied = (error: unknown) => error instanceof ApiError && error.statusCode === 403;
test('one policy consistently controls list scope, ownership and all mutation modes', () => {
  assert.deepEqual(newsPolicy.scope(admin), { authorId: 'mine' });
  assert.deepEqual(newsPolicy.scope(root), {});
  assert.throws(() => requireActor(null), (error: unknown) => error instanceof ApiError && error.statusCode === 401);
  for (const status of statuses) {
    const mine = { authorId: 'mine', status };
    const other = { authorId: 'other', status };
    assert.doesNotThrow(() => newsPolicy.assert(admin, mine, 'read'));
    assert.throws(() => newsPolicy.assert(admin, other, 'read'), denied);
    assert.throws(() => newsPolicy.assert(admin, other, 'edit'), denied);
    if (['DRAFT', 'IN_REVIEW', 'REJECTED'].includes(status)) assert.doesNotThrow(() => newsPolicy.assert(admin, mine, 'edit'));
    else assert.throws(() => newsPolicy.assert(admin, mine, 'edit'), denied);
    for (const action of ['read', 'edit', 'delete', 'status'] as const) assert.doesNotThrow(() => newsPolicy.assert(root, other, action));
    for (const action of ['delete', 'status'] as const) assert.throws(() => newsPolicy.assert(admin, mine, action), denied);
  }
});
test('all 25 transition combinations match the documented state machine', () => {
  const expected: Record<NewsStatus, readonly NewsStatus[]> = {
    DRAFT: ['IN_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED'],
    IN_REVIEW: ['PUBLISHED', 'REJECTED', 'ARCHIVED'], PUBLISHED: ['ARCHIVED'],
    REJECTED: ['DRAFT'], ARCHIVED: ['PUBLISHED'],
  };
  assert.deepEqual(allowedTransitions, expected);
  for (const from of statuses) for (const to of statuses) {
    if (expected[from].includes(to)) assert.doesNotThrow(() => assertTransition(from, to));
    else assert.throws(() => assertTransition(from, to), (error: unknown) =>
      error instanceof ApiError && error.statusCode === 400 && error.message.includes(from));
  }
});
