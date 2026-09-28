import { ApiError } from '../../utils/api-error.js';
export type ImageExtension = 'jpg' | 'png' | 'webp';
const invalid = () => new ApiError(415, 'UNSUPPORTED_IMAGE', 'فقط تصویر معتبر JPEG (.jpg/.jpeg)، PNG یا WebP مجاز است.');

export interface DetectImageOptions {
  /**
   * Group 3. Accept bytes after the JPEG end-of-image marker. Phones append
   * real data there (Samsung trailers, Google/Samsung "motion photo" video,
   * MPF previews), so a strict "file must end in FF D9" rule rejected a large
   * share of genuine .jpg photos. Only safe when the caller RE-ENCODES the
   * image (the device-upload pipeline converts to WebP with sharp, which never
   * copies the trailer). The raw-storage route keeps the strict default, so a
   * JPEG/HTML polyglot can never be stored and served byte-for-byte.
   */
  allowTrailingData?: boolean;
}

/**
 * Browser/OS-reported MIME types that legitimately describe each format.
 * Windows and older Android report `image/pjpeg` / `image/jpg` for .jpg/.jpeg
 * files; the old exact `=== 'image/jpeg'` comparison rejected them. A generic
 * "unknown" type is tolerated because the magic bytes are authoritative; a
 * type that names a DIFFERENT format (text/html, image/png for JPEG bytes...)
 * is still rejected.
 */
const MIME_ALIASES: Record<ImageExtension, readonly string[]> = {
  jpg: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  png: ['image/png', 'image/x-png'],
  webp: ['image/webp'],
};
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function reportedMimeMatches(extension: ImageExtension, reportedMime: string): boolean {
  const normalised = reportedMime.split(';')[0]?.trim().toLowerCase() ?? '';
  return GENERIC_MIME.has(normalised) || MIME_ALIASES[extension].includes(normalised);
}

// SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC): the frame header that
// carries the real dimensions.
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Group 3: structural JPEG check, stricter than the previous "starts with
 * FF D8 FF and ends with FF D9" test. Walks the marker segments from SOI to
 * the first SOS with bounds-checked lengths, requires a frame header (SOF)
 * with non-zero dimensions and 1..4 components before the scan, and requires
 * an EOI marker after the scan data.
 */
function isStructurallyValidJpeg(data: Buffer, allowTrailingData: boolean): boolean {
  if (data.length < 8 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return false;
  let offset = 2;
  let sawFrame = false;
  let scanStart = -1;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return false;
    // Fill bytes: any number of 0xFF may precede a marker.
    let markerAt = offset + 1;
    while (markerAt < data.length && data[markerAt] === 0xff) markerAt += 1;
    if (markerAt + 2 >= data.length) return false;
    const marker = data[markerAt]!;
    // Standalone markers (no length) are not legal before the first scan.
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7)) return false;
    const length = data.readUInt16BE(markerAt + 1);
    if (length < 2) return false;
    const segmentEnd = markerAt + 1 + length;
    if (segmentEnd > data.length) return false;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) return false;
      const height = data.readUInt16BE(markerAt + 4);
      const width = data.readUInt16BE(markerAt + 6);
      const components = data[markerAt + 8]!;
      if (width === 0 || height === 0 || components < 1 || components > 4) return false;
      if (length !== 8 + components * 3) return false;
      sawFrame = true;
    }
    if (marker === 0xda) {
      if (!sawFrame) return false;
      scanStart = segmentEnd;
      break;
    }
    offset = segmentEnd;
  }
  if (scanStart < 0 || scanStart >= data.length - 2) return false;
  if (!allowTrailingData) {
    return data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
  }
  // Lenient mode: an EOI must exist somewhere after the scan header; bytes
  // after it are ignored because the image is re-encoded anyway.
  return data.indexOf(Buffer.from([0xff, 0xd9]), scanStart) !== -1;
}

/** Bounded structural checks, not a full decoder or antivirus scanner. */
export function detectImage(
  data: Buffer,
  reportedMime: string,
  options: DetectImageOptions = {},
): { extension: ImageExtension; mimeType: string } {
  let extension: ImageExtension;
  let mimeType: string;
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    if (!isStructurallyValidJpeg(data, options.allowTrailingData === true)) throw invalid();
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
  if (!reportedMimeMatches(extension, reportedMime)) throw invalid();
  return { extension, mimeType };
}
