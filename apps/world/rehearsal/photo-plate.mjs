import { hallwayLighting } from './look.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const framing = [
  'Create one wide 16:9 cinematic environment background plate for a third-person game with an oblique travelling camera.',
  'The FIRST image is a new photo of the venue. Preserve its distinctive architecture, materials, doors, lamps, wall art and colors. Remove people, screens containing text, and personal possessions.',
  'The SECOND image demonstrates CAMERA ANGLE AND COMPOSITION ONLY. Reconstruct the FIRST room from a diagonal travelling viewpoint from behind and to the RIGHT of a character moving toward screen-right, about 55 degrees off the travel direction. Do not copy the second room’s decor.',
  'The hero travels left to right across the screen. Extend the photographed hallway through a long succession of connected bays. Keep the original materials and landmarks in the near bay, then add a sequence of booths, alcoves and pools of lamp light farther ahead. Leave many strides between landmarks. The single reachable exit is distant beyond the last bay. Show depth down the far side of the booths. The travel line projects from lower-left toward upper-right, with most of the travel horizontal and a little into depth.',
  'Frame a broad walkable strip from 84 percent image height on the left to 64 percent on the right, an entry on the far left and one illuminated exit doorway on the far right. Keep this strip open and visible on a projector.',
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
