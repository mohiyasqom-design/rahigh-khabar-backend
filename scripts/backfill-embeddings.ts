/**
 * Backfills semantic-search embeddings for every published article.
 *
 * Run once after configuring OPENAI_API_KEY and applying the Part 5 migration:
 *   npm run backfill-embeddings
 */
import { PrismaClient } from '@prisma/client';
import { isSemanticSearchConfigured } from '../src/config/env.js';
import {
  buildEmbeddingSource, createEmbedding, storeNewsEmbedding,
} from '../src/modules/search/embedding.service.js';

const BATCH_SIZE = 20;

async function main(): Promise<void> {
  if (!isSemanticSearchConfigured()) {
    process.stderr.write('OPENAI_API_KEY is not configured; nothing to backfill.\n');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  let processed = 0;
  let stored = 0;
  try {
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.news.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true, title: true, lead: true, summary: true, body: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const news of batch) {
        processed += 1;
        const vector = await createEmbedding(buildEmbeddingSource(news));
        if (!vector) {
          process.stderr.write(`skipped ${news.id} (no embedding returned)\n`);
          continue;
        }
        await storeNewsEmbedding(prisma, news.id, vector);
        stored += 1;
      }
      cursor = batch[batch.length - 1]?.id;
      process.stdout.write(`processed ${processed}, stored ${stored}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write(`done: ${stored}/${processed} embeddings stored\n`);
}

await main();
