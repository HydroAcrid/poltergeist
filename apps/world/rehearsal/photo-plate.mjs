import { hallwayLighting } from './look.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const framing = [
  'Create one wide 16:9 empty hallway background for a close right-shoulder adventure camera.',
  'The FIRST photo is the actual venue. Preserve its architecture, materials, floor, doors, lamps and recognizable artwork. Clear the people, personal possessions and screens.',
  'The SECOND image shows the trailing camera direction. Reconstruct the FIRST room looking down its aisle, from eye level directly behind and slightly right of a small traveler. The travel direction is within 15 degrees of the optical axis. Reserve the left foreground for a large visible head, shoulders and backpack that will be added later.',
  'The floor recedes from the lower central foreground toward a vanishing point just right of center, about 60 percent across. Keep the next few steps, adjacent gaps and a reachable illuminated exit visible in the middle and right of the image. Extend the photographed hall through successive recognizable lamp-lit bays. Near furniture at the sides gives moving perspective while keeping the route open.',
  hallwayLighting,
  'Leave out people, robots, ghosts, obstacles, interface, labels and text.',
].join(' ');

export const photoKey = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

function generatedImage(response) {
  const part = response.candidates?.[0]?.content?.parts?.find(
    ({ inlineData, thought }) =>
      !thought && inlineData?.data && inlineData.mimeType?.startsWith('image/'),
  );
  if (!part) throw Error('The image model did not return a room.');
  const bytes = Buffer.from(part.inlineData.data, 'base64');
  if (
    bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    return { mime: 'image/png', bytes };
  if (
    bytes.length > 4 &&
    bytes.readUInt16BE(0) === 0xffd8 &&
    bytes.readUInt16BE(bytes.length - 2) === 0xffd9
  )
    return { mime: 'image/jpeg', bytes };
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mime: 'image/webp', bytes };
  throw Error('The image model returned an unreadable room.');
}

export async function generatePhotoPlate({ photo, reference, captureDir }) {
  const sdk = createRequire(resolve(captureDir, 'package.json'))(
    '@google/genai',
  );
  const key =
    process.env.GEMINI_API_KEY ||
    parseEnv(readFileSync(resolve(captureDir, '../../../.env'), 'utf8'))
      .GEMINI_API_KEY;
  if (!key) throw Error('The room generator is unavailable.');
  const ai = new sdk.GoogleGenAI({ apiKey: key });
  const result = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image',
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: photo.toString('base64'),
            },
          },
          {
            inlineData: {
              mimeType: 'image/webp',
              data: reference.toString('base64'),
            },
          },
          { text: framing },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
    },
  });
  return generatedImage(result);
}

// Jobs and completed plates share one entry keyed by the exact source, so reloads,
// duplicate clicks and switching photos cannot pay for or publish the wrong room.
export function createPlateCache({
  captureDir,
  reference,
  generate = generatePhotoPlate,
}) {
  const cache = new Map();
  return {
    get: (key) => cache.get(key),
    prepare(key, photo) {
      const existing = cache.get(key);
      if (existing && !existing.error) return existing;
      const entry = { pending: true };
      cache.set(key, entry);
      Promise.resolve()
        .then(() => generate({ photo, reference, captureDir }))
        .then((image) => {
          entry.image = image;
        })
        .catch(() => {
          entry.error = 'The room could not be prepared. Try again.';
        })
        .finally(() => {
          entry.pending = false;
        });
      return entry;
    },
  };
}
