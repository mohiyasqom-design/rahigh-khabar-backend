import { z } from 'zod';
export const idSchema = z.string().trim().min(1).max(128);
export const slugSchema = z.string().min(1).max(200).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const idParamsSchema = z.object({ id: idSchema }).strict();
export const emptyQuerySchema = z.object({}).strict();
const positiveInteger = (max: number, fallback: string) => z.string().regex(/^[1-9][0-9]*$/)
  .default(fallback).transform(Number).pipe(z.number().int().min(1).max(max));
// Bound skip as well as pageSize to avoid accidental unbounded SQL offsets.
export const paginationShape = { page: positiveInteger(100_000, '1'), pageSize: positiveInteger(100, '20') };
export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}
