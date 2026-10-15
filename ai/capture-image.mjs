import sharp from 'sharp';

// NativeImage bitmap format is platform-dependent. Probe it instead of assuming
// channel order; unsupported layouts and translucent crops retain the PNG path.
export function bitmapLayout(nativeImage) {
  if (!nativeImage?.createFromBuffer) return null;
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGMQNE39DwACsQGrJn3n/AAAAABJRU5ErkJggg==', 'base64');
    const b = nativeImage.createFromBuffer(png).toBitmap();
    if (b.length !== 4 || b[1] !== 53 || b[3] !== 255) return null;
    return b[0] === 101 && b[2] === 17 ? 'bgra' : b[0] === 17 && b[2] === 101 ? 'rgba' : null;
  } catch { return null; }
}

export async function focusImage(image, extract, valid, padding, size, layout) {
  let input;
  if (layout === 'bgra' || layout === 'rgba') {
    const { width, height } = image.getSize(), bitmap = image.toBitmap();
    if (bitmap.length === width * height * 4) {
      const crop = Buffer.allocUnsafe(extract.width * extract.height * 4);
      let opaque = true;
      for (let y = 0, out = 0; y < extract.height && opaque; y++) {
        let source = ((extract.top + y) * width + extract.left) * 4;
        for (let x = 0; x < extract.width; x++, source += 4, out += 4) {
          if (bitmap[source + 3] !== 255) { opaque = false; break; }
          crop[out] = bitmap[source + (layout === 'bgra' ? 2 : 0)];
          crop[out + 1] = bitmap[source + 1];
          crop[out + 2] = bitmap[source + (layout === 'bgra' ? 0 : 2)];
          crop[out + 3] = 255;
        }
      }
      // Avoid full-window PNG encode/decode. Do not guess alpha premultiplication.
      if (opaque) input = sharp(crop, { raw: { width: extract.width, height: extract.height, channels: 4 } });
    }
  }
  input ??= sharp(image.toPNG()).extract(extract);
  const cropped = await input.resize(valid.width, valid.height).raw().toBuffer({ resolveWithObject: true });
  return sharp({ create: { width: size, height: size, channels: 4, background: '#151922' } })
    .composite([{ input: cropped.data, raw: { width: cropped.info.width, height: cropped.info.height, channels: cropped.info.channels }, left: padding.left, top: padding.top }])
    .png().toBuffer();
}
