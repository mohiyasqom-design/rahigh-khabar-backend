import { ApiError } from '../../utils/api-error.js';
export type ImageExtension = 'jpg' | 'png' | 'webp';
const invalid = () => new ApiError(415, 'UNSUPPORTED_IMAGE', 'فقط تصویر معتبر JPEG، PNG یا WebP مجاز است.');
/** Bounded structural checks, not a full decoder or antivirus scanner. */
export function detectImage(data: Buffer, reportedMime: string): { extension: ImageExtension; mimeType: string } {
  let extension: ImageExtension;
  let mimeType: string;
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) throw invalid();
    extension = 'jpg'; mimeType = 'image/jpeg';
  } else if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    let sawData = false;
    let sawEnd = false;
    while (offset + 12 <= data.length) {
      const size = data.readUInt32BE(offset);
      const type = data.toString('ascii', offset + 4, offset + 8);
      if (offset + 12 + size > data.length) throw invalid();
      if (offset === 8 && (type !== 'IHDR' || size !== 13)) throw invalid();
      if (offset !== 8 && type === 'IHDR') throw invalid();
      if (type === 'IDAT' && size > 0) sawData = true;
      offset += 12 + size;
      if (type === 'IEND') { if (size !== 0 || offset !== data.length) throw invalid(); sawEnd = true; break; }
    }
    if (!sawData || !sawEnd) throw invalid();
    extension = 'png'; mimeType = 'image/png';
  } else if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    if (data.readUInt32LE(4) + 8 !== data.length) throw invalid();
    let offset = 12;
    let sawImage = false;
    while (offset + 8 <= data.length) {
      const type = data.toString('ascii', offset, offset + 4);
      const size = data.readUInt32LE(offset + 4);
      if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') {
        if (size === 0) throw invalid(); sawImage = true;
      }
      offset += 8 + size + (size % 2);
      if (offset > data.length) throw invalid();
    }
    if (!sawImage || offset !== data.length) throw invalid();
    extension = 'webp'; mimeType = 'image/webp';
  } else { throw invalid(); }
  if (reportedMime !== mimeType) throw invalid();
  return { extension, mimeType };
}
