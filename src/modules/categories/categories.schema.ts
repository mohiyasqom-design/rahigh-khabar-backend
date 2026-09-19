import { z } from 'zod';
import { slugSchema } from '../../utils/validation.js';
// Navigation position. Bounded so a hostile payload cannot store a value the
// frontend then has to sort around; ties fall back to name in the service.
export const categoryOrderSchema = z.number().int().min(0).max(10_000);
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120), slug: slugSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  order: categoryOrderSchema.optional(),
}).strict();
export const updateCategorySchema = createCategorySchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required');
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export const categoryResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'slug', 'description', 'order'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' },
    description: { type: ['string', 'null'] }, order: { type: 'integer' },
  },
} as const;
export const categoriesResponseSchema = { type: 'array', items: categoryResponseSchema } as const;
