import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { writeTransaction } from '../../utils/database.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js';
export const categorySelect = { id: true, name: true, slug: true, description: true, order: true } satisfies Prisma.CategorySelect;
// Navigation order is the contract: the header, the footer and the admin picker
// all render this array as-is, so the sort lives here and not in three clients.
// name/id keep the order total when two categories share an `order`.
export function listCategories(prisma: PrismaClient) {
  return prisma.category.findMany({ select: categorySelect, orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
}
export function createCategory(prisma: PrismaClient, input: CreateCategoryInput) {
  return writeTransaction(prisma, (tx) => tx.category.create({
    data: { name: input.name, slug: input.slug, description: input.description ?? null, order: input.order ?? 0 },
    select: categorySelect,
  }));
}
export function updateCategory(prisma: PrismaClient, id: string, input: UpdateCategoryInput) {
  const data: Prisma.CategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  if (input.order !== undefined) data.order = input.order;
  return writeTransaction(prisma, (tx) => tx.category.update({ where: { id }, data, select: categorySelect }));
}
// Stage 10 decision: deletion is BLOCKED while any news item still points at
// the category, instead of silently cascading the join rows. The old behaviour
// left PUBLISHED articles with zero categories - a state every read path in the
// site treats as impossible - and it was destructive without warning. Moving
// the articles automatically was rejected too: which category they belong to is
// an editorial call, not a side effect of a DELETE. The count is returned in the
// message so the caller knows how much work reassignment is.
export async function deleteCategory(prisma: PrismaClient, id: string): Promise<void> {
  await writeTransaction(prisma, async (tx) => {
    const category = await tx.category.findUnique({ where: { id }, select: { id: true } });
    if (!category) throw new ApiError(404, 'NOT_FOUND', 'دسته‌بندی پیدا نشد.');
    // Counted inside the serializable write transaction, so a news item cannot
    // be attached to the category between the check and the delete.
    const linked = await tx.newsCategory.count({ where: { categoryId: id } });
    if (linked > 0) {
      throw new ApiError(409, 'CATEGORY_IN_USE',
        `این دسته‌بندی به ${linked} خبر متصل است؛ ابتدا دستهٔ آن خبرها را تغییر دهید و سپس حذف کنید.`);
    }
    await tx.category.delete({ where: { id }, select: { id: true } });
  });
}
