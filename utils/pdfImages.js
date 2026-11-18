/**
 * Question images inside generated PDFs (answer keys).
 *
 * PDFs used to print "[Image: <link>]" because the images live in a private
 * bucket. These helpers read the images from S3 before the PDF is drawn,
 * convert them to JPEG (PDFKit only draws JPEG/PNG; uploads may be WebP/GIF),
 * and draw them scaled to fit the page.
 */
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');
const { normalizeS3Reference, isSafeImageKey } = require('./s3MediaSigner');

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 1200; // longest side after resizing: sharp enough to print, small PDF
const PARALLEL = 6;

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* images are then skipped */ }

/** S3 key for a stored image link or key, or '' when it isn't one of our images. */
function imageKeyOf(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const key = normalizeS3Reference(raw.trim())?.s3Key || '';
  return isSafeImageKey(key) ? key : '';
}

async function readObject(key) {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (Number(object.ContentLength) > MAX_SOURCE_BYTES) throw new Error('image too large');
  return Buffer.from(await object.Body.transformToByteArray());
}

async function toPdfImage(source) {
  const out = await sharp(source, { animated: false })
    .rotate()
    .resize({ width: MAX_PIXELS, height: MAX_PIXELS, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Loads the images for a list of stored image links.
 * @returns {Promise<Map<string, {buffer: Buffer, width: number, height: number}>>} by S3 key
 */
async function loadPdfImages(rawImages, { read = readObject } = {}) {
  const images = new Map();
  if (!sharp) return images;
  const keys = [...new Set((rawImages || []).map(imageKeyOf).filter(Boolean))];
  for (let i = 0; i < keys.length; i += PARALLEL) {
    await Promise.all(keys.slice(i, i + PARALLEL).map(async (key) => {
      try {
        images.set(key, await toPdfImage(await read(key)));
      } catch (err) {
        console.warn(`[PDF images] Could not load ${key}: ${err.message}`);
      }
    }));
  }
  return images;
}

/**
 * Draws a question image at doc.y, scaled to fit, starting a new page when it
 * would run past `bottom`. Draws a short note instead when the image is missing.
 */
function drawPdfImage(doc, images, raw, { x, maxWidth, maxHeight = 260, bottom, topOfPage }) {
  const image = images && images.get(imageKeyOf(raw));
  if (!image) {
    doc.fillColor('#718096').fontSize(8.5).font('Helvetica-Oblique')
      .text('[Image available in the online answer key]', x, doc.y, { width: maxWidth });
    doc.moveDown(0.2);
    return;
  }
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  if (doc.y + height > bottom) {
    doc.addPage();
    doc.y = topOfPage;
  }
  const top = doc.y;
  doc.image(image.buffer, x, top, { width, height });
  doc.y = top + height;
  doc.moveDown(0.4);
}

module.exports = { imageKeyOf, loadPdfImages, drawPdfImage };
