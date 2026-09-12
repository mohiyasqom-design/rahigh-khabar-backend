import { z } from 'zod';
import { paginationShape } from '../../utils/validation.js';
export const mediaQuerySchema = z.object(paginationShape).strict();
export type MediaQuery = z.infer<typeof mediaQuerySchema>;
// Optional; admin UI should strongly encourage descriptive Persian alt text.
export const altTextSchema = z.string().trim().max(500).transform((value) => value || null);
export const mediaResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'url', 'altText', 'width', 'height', 'sizeBytes', 'mimeType', 'createdAt'],
  properties: {
    id: { type: 'string' }, url: { type: 'string' }, altText: { type: ['string', 'null'] },
    width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] },
    sizeBytes: { type: ['integer', 'null'] }, mimeType: { type: 'string' }, createdAt: { type: 'string' },
  },
} as const;
export const mediaPageResponseSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'pagination'],
  properties: {
    items: { type: 'array', items: mediaResponseSchema },
    pagination: { type: 'object', additionalProperties: false,
      required: ['page', 'pageSize', 'total', 'totalPages'],
      properties: { page: { type: 'integer' }, pageSize: { type: 'integer' },
        total: { type: 'integer' }, totalPages: { type: 'integer' } } },
  },
} as const;
