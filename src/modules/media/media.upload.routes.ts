import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../utils/api-error.js';
import { errorResponses } from '../../utils/http-schemas.js';
import { idParamsSchema, paginationShape } from '../../utils/validation.js';
import { requireSiteUser } from '../users/index.js';
import { uploadMediaFile } from './media.upload.service.js';
import type { MediaStorage } from './storage.js';

const altTextSchema = z.string().trim().max(200).optional();
const listQuerySchema = z.object({ ...paginationShape }).strict();

const mediaSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'url', 'altText', 'width', 'height', 'sizeBytes', 'mimeType', 'createdAt'],
  properties: {
    id: { type: 'string' }, url: { type: 'string' }, altText: { type: ['string', 'null'] },
    width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] },
    sizeBytes: { type: ['integer', 'null'] }, mimeType: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const listSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'pagination'],
  properties: {
    items: { type: 'array', items: mediaSchema },
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

const avatarSchema = {
  type: 'object', additionalProperties: false, required: ['avatarUrl'],
  properties: { avatarUrl: { type: 'string' } },
} as const;

/**
 * Reads the single file part plus the optional `altText` field. `@fastify/
 * multipart` is registered by the media module, so its limits (one file, the
 * configured byte ceiling) already apply here.
 */
async function readUpload(request: FastifyRequest, maxUploadSize: number) {
  const data = await request.file();
  if (!data) throw new ApiError(400, 'FILE_REQUIRED', 'انتخاب فایل تصویر الزامی است.');
  const buffer = await data.toBuffer();
  if (data.file.truncated || buffer.byteLength > maxUploadSize) {
    throw new ApiError(413, 'FILE_TOO_LARGE',
      `حجم فایل بیش از حد مجاز است (حداکثر ${Math.floor(maxUploadSize / 1024 / 1024)} مگابایت).`);
  }
  const rawAlt = (data.fields as Record<string, unknown> | undefined)?.altText;
  const altValue = rawAlt && typeof rawAlt === 'object' && 'value' in rawAlt
    ? (rawAlt as { value?: unknown }).value
    : undefined;
  const altText = altTextSchema.parse(typeof altValue === 'string' ? altValue : undefined);
  return {
    file: {
      buffer,
      filename: data.filename || 'upload',
      mimetype: data.mimetype || 'application/octet-stream',
    },
    altText: altText && altText.length > 0 ? altText : null,
  };
}

export interface MediaUploadOptions {
  storage: MediaStorage;
  maxUploadSize: number;
}

/**
 * Stage 10 Part 5 - uploading images straight from the device, for the admin
 * panel (news cover and editor images) and for the visitor avatar.
 */
export const mediaUploadRoutes: FastifyPluginAsync<MediaUploadOptions> = async (app, options) => {
  const { storage, maxUploadSize } = options;

  app.post('/media/upload', {
    onRequest: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: { response: { 201: mediaSchema, ...errorResponses } },
  }, async (request, reply) => {
    const { file, altText } = await readUpload(request, maxUploadSize);
    const media = await uploadMediaFile(app.prisma, storage, file, altText, {
      staffId: request.authUser?.id ?? null,
    });
    reply.code(201);
    return media;
  });

  app.get('/media', {
    onRequest: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: { response: { 200: listSchema, ...errorResponses } },
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const [items, total] = await Promise.all([
      app.prisma.media.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, url: true, altText: true, width: true, height: true,
          sizeBytes: true, mimeType: true, createdAt: true,
        },
      }),
      app.prisma.media.count(),
    ]);
    return {
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      pagination: {
        page: query.page, pageSize: query.pageSize, total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  });

  app.delete('/media/:id', {
    onRequest: [app.authenticate, app.requireRole('SUPER_ADMIN')],
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const media = await app.prisma.media.findUnique({
      where: { id }, select: { id: true, url: true },
    });
    if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'تصویر پیدا نشد.');
    // Deleting a cover in use would blank it on published articles.
    const used = await app.prisma.news.count({ where: { coverImageId: id } });
    if (used > 0) {
      throw new ApiError(409, 'MEDIA_IN_USE', 'این تصویر در اخبار استفاده شده است.');
    }
    const pending = await storage.prepareRemoval(media.id, media.url);
    try {
      await app.prisma.media.delete({ where: { id } });
      await pending.commit();
    } catch (error) {
      await pending.rollback();
      throw error;
    }
    reply.code(204);
    return null;
  });

  // Site visitors replace their Google avatar with their own picture.
  app.post('/users/me/avatar', {
    onRequest: [app.authenticateSiteUser],
    schema: { response: { 200: avatarSchema, ...errorResponses } },
  }, async (request) => {
    const user = requireSiteUser(request);
    const { file, altText } = await readUpload(request, maxUploadSize);
    const media = await uploadMediaFile(app.prisma, storage, file, altText, {
      siteUserId: user.id,
    });
    await app.prisma.regularUser.update({
      where: { id: user.id }, data: { avatarUrl: media.url },
    });
    return { avatarUrl: media.url };
  });
};

export default mediaUploadRoutes;
