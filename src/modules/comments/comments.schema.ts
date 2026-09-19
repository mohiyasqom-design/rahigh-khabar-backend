import { z } from 'zod';
import { idParamsSchema, paginationShape } from '../../utils/validation.js';

// Re-exported so comments.routes.ts has a single import surface for the module
// (the routes file previously imported it from here and crashed at load time).
export { idParamsSchema };

export const COMMENT_MAX_LENGTH = 1000;

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
}).strict();

export const commentListQuerySchema = z.object({ ...paginationShape }).strict();

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

const nullableString = { type: ['string', 'null'] } as const;

export const commentSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'content', 'createdAt', 'user'],
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    createdAt: { type: 'string' },
    user: {
      type: 'object', additionalProperties: false,
      required: ['id', 'username', 'displayName', 'avatarUrl'],
      properties: {
        id: { type: 'string' },
        username: nullableString,
        displayName: { type: 'string' },
        avatarUrl: nullableString,
      },
    },
  },
} as const;

export const commentPageSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'pagination'],
  properties: {
    items: { type: 'array', items: commentSchema },
    pagination: {
      type: 'object', additionalProperties: false,
      required: ['page', 'pageSize', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer' }, pageSize: { type: 'integer' },
        total: { type: 'integer' }, totalPages: { type: 'integer' },
      },
    },
  },
} as const;
