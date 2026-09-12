import type { Prisma, PrismaClient } from '@prisma/client';
import { writeTransaction } from '../../utils/database.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js';
export const categorySelect = { id: true, name: true, slug: true, description: true } satisfies Prisma.CategorySelect;
export function listCategories(prisma: PrismaClient) {
  return prisma.category.findMany({ select: categorySelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}
export function createCategory(prisma: PrismaClient, input: CreateCategoryInput) {
  return writeTransaction(prisma, (tx) => tx.category.create({
    data: { name: input.name, slug: input.slug, description: input.description ?? null }, select: categorySelect,
  }));
}
export function updateCategory(prisma: PrismaClient, id: string, input: UpdateCategoryInput) {
  const data: Prisma.CategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  return writeTransaction(prisma, (tx) => tx.category.update({ where: { id }, data, select: categorySelect }));
}
export async function deleteCategory(prisma: PrismaClient, id: string): Promise<void> {
  // Deliberate exception to the create/update nonempty-category invariant:
  // deleting a category cascades ONLY join rows, even on PUBLISHED news.
  // The news survives and may now have zero categories (see API docs).
  await writeTransaction(prisma, (tx) => tx.category.delete({ where: { id }, select: { id: true } }));
}
