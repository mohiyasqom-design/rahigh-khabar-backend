import { imageSize } from 'image-size';
import { ApiError } from '../../utils/api-error.js';
import { detectImage } from './media.signature.js';
export type { ImageExtension } from './media.signature.js';
export function inspectImage(buffer: Buffer, reportedMime: string) {
  const { extension, mimeType } = detectImage(buffer, reportedMime);
  const invalid = () => new ApiError(415, 'UNSUPPORTED_IMAGE', 'ساختار یا ابعاد تصویر نامعتبر است.');
  try {
    const result = imageSize(buffer);
    if (result.type !== extension || typeof result.width !== 'number' || typeof result.height !== 'number' ||
        !Number.isSafeInteger(result.width) ||
        !Number.isSafeInteger(result.height) || result.width <= 0 || result.height <= 0 ||
        result.width > 2_147_483_647 || result.height > 2_147_483_647) throw invalid();
    return { extension, mimeType, width: result.width, height: result.height, sizeBytes: buffer.length };
  } catch { throw invalid(); }
}
