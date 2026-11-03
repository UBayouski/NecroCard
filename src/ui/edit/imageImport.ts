import { ditherRgba, fitWithin } from './dither.js';
import { encodeBitsPng } from './png.js';
import { MIN_SIZE } from './geometry.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageImportError';
  }
}

/** A decoded picture that can be drawn at a given size and read back as RGBA. */
export interface DecodedImage {
  width: number;
  height: number;
  draw(w: number, h: number): Uint8ClampedArray;
  close(): void;
}

export interface ImportDeps {
  decode(file: Blob): Promise<DecodedImage>;
}

/**
 * Default decoder: createImageBitmap on the local file, drawn to an offscreen canvas. Only the
 * decoded file's pixels are read back — never the card DOM — and nothing touches the network.
 */
export const browserDecode: ImportDeps['decode'] = async file => {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw(w, h) {
      const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!ctx) throw new ImageImportError('This browser cannot read images');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    },
    close: () => bitmap.close(),
  };
};

/** Check type and size before decoding (REQ-4.4). */
export function checkImageFile(file: Blob): void {
  if (!file.type.startsWith('image/')) throw new ImageImportError('the file is not an image');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageImportError('the file is larger than 5 MB');
}

/**
 * Import an image file as a 1-bit PNG data URL. `size` is the target rect size, or 'fit' to
 * fit the picture inside 256 × 256 keeping its aspect ratio ("Add image").
 */
export async function importImage(
  file: Blob,
  size: { w: number; h: number } | 'fit',
  deps: ImportDeps = { decode: browserDecode },
): Promise<{ src: string; w: number; h: number }> {
  checkImageFile(file);
  let decoded: DecodedImage;
  try {
    decoded = await deps.decode(file);
  } catch (e) {
    if (e instanceof ImageImportError) throw e;
    throw new ImageImportError('the image could not be read');
  }
  try {
    const target = size === 'fit' ? fitWithin(decoded.width, decoded.height) : {
      w: Math.max(MIN_SIZE, Math.round(size.w)), h: Math.max(MIN_SIZE, Math.round(size.h)),
    };
    const rgba = decoded.draw(target.w, target.h);
    const bits = ditherRgba(rgba, target.w, target.h);
    return { src: encodeBitsPng(bits, target.w, target.h), w: target.w, h: target.h };
  } finally {
    decoded.close();
  }
}

/**
 * Ask the user for one local image file. Resolves null if the picker is dismissed (browsers
 * that fire `cancel`) — otherwise the promise simply stays pending, which is harmless.
 */
export function pickImageFile(doc: Document = document): Promise<File | null> {
  return new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'edit-file-input';
    input.hidden = true;
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    doc.body.append(input);
    input.click();
  });
}
