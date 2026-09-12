import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '../../utils/api-error.js';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema, idParamsSchema } from '../../utils/validation.js';
import { altTextSchema, mediaPageResponseSchema, mediaQuerySchema, mediaResponseSchema } from './media.schema.js';
import { createMedia, deleteMedia, listMedia } from './media.service.js';
import type { MediaStorage } from './storage.js';
export interface MediaRouteOptions { storage: MediaStorage; maxUploadSize: number; }
export const mediaRoutes: FastifyPluginAsync<MediaRouteOptions> = async (app, options) => {
  const editors = [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')];
  app.post('/', {
    // Authenticate before multipart parsing/consumption, using existing auth hooks.
    onRequest: editors, bodyLimit: options.maxUploadSize + 16_384,
    schema: { response: { 201: mediaResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    if (!request.isMultipart()) throw new ApiError(415, 'MULTIPART_REQUIRED', 'بدنه باید multipart/form-data باشد.');
    let file: { data: Buffer; mimeType: string } | undefined;
    let altText: string | null = null;
    let seenAlt = false;
    // multipart supports throwFileSizeLimit at runtime, but its parts() options
    // type omits it. Extend only this call's type; keep size-limit behavior intact.
    type PartsOptionsWithThrow = NonNullable<Parameters<typeof request.parts>[0]> & {
      throwFileSizeLimit?: boolean;
    };
    const partsOptions: PartsOptionsWithThrow = {
      limits: { files: 1, fields: 1, parts: 2, fileSize: options.maxUploadSize, fieldSize: 2048, fieldNameSize: 100 },
      throwFileSizeLimit: true,
    };
    // Consume and validate all parts before creating any file/DB row.
    for await (const part of request.parts(partsOptions)) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) {
          part.file.resume();
          throw new ApiError(400, 'INVALID_FILE_FIELD', 'دقیقاً یک فایل با نام فیلد file ارسال کنید.');
        }
        const data = await part.toBuffer();
        if (part.file.truncated || data.length > options.maxUploadSize) {
          throw new ApiError(413, 'FILE_TOO_LARGE', 'حجم تصویر بیش از حد مجاز است.');
        }
        file = { data, mimeType: part.mimetype };
      } else {
        if (part.fieldname !== 'altText' || seenAlt || part.fieldnameTruncated || part.valueTruncated) {
          throw new ApiError(400, 'INVALID_MEDIA_FIELD', 'فقط یک فیلد اختیاری altText مجاز است.');
        }
        seenAlt = true;
        altText = altTextSchema.parse(part.value);
      }
    }
    if (!file) throw new ApiError(400, 'FILE_REQUIRED', 'یک فایل تصویری ارسال کنید.');
    return reply.code(201).send(await createMedia(app.prisma, options.storage, file.data, file.mimeType, altText));
  });
  app.get('/', { onRequest: editors, schema: { response: { 200: mediaPageResponseSchema, ...errorResponses } } },
    async (request) => listMedia(app.prisma, mediaQuerySchema.parse(request.query)));
  app.delete('/:id', {
    onRequest: [app.authenticate, app.requireRole('SUPER_ADMIN')],
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    await deleteMedia(app.prisma, options.storage, id);
    return reply.code(204).send();
  });
};
