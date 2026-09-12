import { z } from 'zod';
import { idSchema, paginationShape, slugSchema } from '../../utils/validation.js';
import { categoryResponseSchema } from '../categories/categories.schema.js';
export const newsStatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED']);
const categoryIdsSchema = z.array(idSchema).min(1).max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate category IDs are not allowed');
// Strict schemas reject status/authorId and all unknown keys with 400.
// A typo or privilege-escalation attempt must never be silently accepted.
export const createNewsSchema = z.object({
  title: z.string().trim().min(1).max(300), slug: slugSchema,
  summary: z.string().trim().max(2000).nullable().optional(),
  lead: z.string().trim().min(1).max(5000), body: z.string().trim().min(1).max(500_000),
  categoryIds: categoryIdsSchema, coverImageId: idSchema.nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  metaDescription: z.string().trim().max(500).nullable().optional(),
}).strict();
export const updateNewsSchema = createNewsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required');
export const changeStatusSchema = z.object({ status: newsStatusSchema }).strict();
export const adminNewsQuerySchema = z.object({
  ...paginationShape, status: newsStatusSchema.optional(), categoryId: idSchema.optional(),
}).strict();
export const publicNewsQuerySchema = z.object({ ...paginationShape, categorySlug: slugSchema.optional() }).strict();
export const newsSlugParamsSchema = z.object({ slug: slugSchema }).strict();
export type CreateNewsInput = z.infer<typeof createNewsSchema>;
export type UpdateNewsInput = z.infer<typeof updateNewsSchema>;
export type AdminNewsQuery = z.infer<typeof adminNewsQuerySchema>;
export type PublicNewsQuery = z.infer<typeof publicNewsQuerySchema>;

const nullableString = { type: ['string', 'null'] } as const;
const coverImageSchema = {
  anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false, required: ['url', 'altText', 'width', 'height'],
    properties: { url: { type: 'string' }, altText: nullableString,
      width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] } },
  }],
} as const;
const publicProperties = {
  title: { type: 'string' }, slug: { type: 'string' }, summary: nullableString,
  lead: { type: 'string' }, publishedAt: nullableString,
  author: { type: 'object', additionalProperties: false, required: ['displayName'], properties: { displayName: { type: 'string' } } },
  coverImage: coverImageSchema, categories: { type: 'array', items: categoryResponseSchema },
} as const;
export const publicNewsItemSchema = {
  type: 'object', additionalProperties: false, required: Object.keys(publicProperties), properties: publicProperties,
} as const;
export const publicNewsDetailSchema = {
  type: 'object', additionalProperties: false,
  required: [...Object.keys(publicProperties), 'body', 'seoTitle', 'metaDescription'],
  properties: { ...publicProperties, body: { type: 'string' }, seoTitle: nullableString, metaDescription: nullableString },
} as const;
export const adminNewsResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'slug', 'status', 'authorId', 'categories', 'publishedAt'],
  properties: {
    ...publicNewsDetailSchema.properties, id: { type: 'string' }, authorId: { type: 'string' },
    coverImageId: nullableString, status: { type: 'string', enum: newsStatusSchema.options },
    createdAt: { type: 'string' }, updatedAt: { type: 'string' },
  },
} as const;
export function paginatedResponseSchema(items: object) {
  return {
    type: 'object', additionalProperties: false, required: ['items', 'pagination'],
    properties: {
      items: { type: 'array', items },
      pagination: { type: 'object', additionalProperties: false, required: ['page', 'pageSize', 'total', 'totalPages'],
        properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
    },
  } as const;
}
