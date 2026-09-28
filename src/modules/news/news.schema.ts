import { z } from 'zod';
import { idSchema, paginationShape, slugSchema } from '../../utils/validation.js';
import { categoryResponseSchema } from '../categories/categories.schema.js';
export const newsStatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED', 'REJECTED']);
// Group 1: editorial tags. Lowercase on the wire, uppercase enum in Postgres.
// Multi-select: an article may be featured AND trending at the same time.
export const NEWS_TAGS = ['featured', 'trending', 'latest'] as const;
export const newsTagSchema = z.enum(NEWS_TAGS);
export type NewsTag = z.infer<typeof newsTagSchema>;
const newsTagsSchema = z.array(newsTagSchema).max(NEWS_TAGS.length)
  .refine((tags) => new Set(tags).size === tags.length, 'Duplicate tags are not allowed');
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
  scheduledFor: z.string().trim().datetime({ offset: true }).nullable().optional(),
  // Optional: no tag at all is valid and simply means "regular, date-ordered".
  tags: newsTagsSchema.optional(),
}).strict();
export const updateNewsSchema = createNewsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required');
export const changeStatusSchema = z.object({ status: newsStatusSchema }).strict();
export const adminNewsQuerySchema = z.object({
  ...paginationShape, status: newsStatusSchema.optional(), categoryId: idSchema.optional(),
  tag: newsTagSchema.optional(),
}).strict();
// `tag` powers GET /news?tag=featured (homepage slider) and ?tag=trending.
export const publicNewsQuerySchema = z.object({
  ...paginationShape, categorySlug: slugSchema.optional(), tag: newsTagSchema.optional(),
}).strict();
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
  // Group 1: without this entry the serializer would silently strip the tags.
  tags: { type: 'array', items: { type: 'string', enum: [...NEWS_TAGS] } },
} as const;
export const publicNewsItemSchema = {
  type: 'object', additionalProperties: false, required: Object.keys(publicProperties), properties: publicProperties,
} as const;
export const publicNewsDetailSchema = {
  type: 'object', additionalProperties: false,
  required: [...Object.keys(publicProperties), 'id', 'body', 'seoTitle', 'metaDescription',
    'likesCount', 'commentsCount', 'likedByCurrentUser'],
  properties: {
    ...publicProperties, id: { type: 'string' }, body: { type: 'string' },
    seoTitle: nullableString, metaDescription: nullableString,
    // Serializer whitelist: without these the counters were silently stripped
    // from every public article response.
    likesCount: { type: 'integer' }, commentsCount: { type: 'integer' },
    likedByCurrentUser: { type: 'boolean' },
  },
} as const;
export const adminNewsResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'slug', 'status', 'authorId', 'categories', 'publishedAt'],
  properties: {
    ...publicNewsDetailSchema.properties, id: { type: 'string' }, authorId: { type: 'string' },
    coverImageId: nullableString, status: { type: 'string', enum: newsStatusSchema.options },
    // Stage 10 Part 5: without this the serializer strips the queue time and
    // the admin form could never show an existing schedule.
    scheduledFor: nullableString,
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
