import { z } from 'zod';
import { idSchema, paginationShape } from '../../utils/validation.js';

// Two characters is the shortest useful Persian query; the upper bound keeps
// pathological strings out of the full-text parser and the embedding request.
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  categoryId: idSchema.optional(),
  mode: z.enum(['auto', 'keyword', 'semantic']).default('auto'),
  ...paginationShape,
}).strict();
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
}).strict();

const itemSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'slug', 'lead', 'publishedAt', 'coverImageUrl', 'categories'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' },
    lead: { type: 'string' }, publishedAt: { type: ['string', 'null'] },
    coverImageUrl: { type: ['string', 'null'] },
    categories: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'slug'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' } },
      },
    },
  },
} as const;

export const searchResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['items', 'pagination', 'mode', 'degraded'],
  properties: {
    items: { type: 'array', items: itemSchema },
    pagination: {
      type: 'object', additionalProperties: false,
      required: ['page', 'pageSize', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer' }, pageSize: { type: 'integer' },
        total: { type: 'integer' }, totalPages: { type: 'integer' },
      },
    },
    // `mode` tells the UI which engine answered; `degraded` means semantic
    // search was requested but unavailable, so the notice can be shown.
    mode: { type: 'string' },
    degraded: { type: 'boolean' },
  },
} as const;

export const suggestResponseSchema = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'slug'],
        properties: { title: { type: 'string' }, slug: { type: 'string' } },
      },
    },
  },
} as const;
