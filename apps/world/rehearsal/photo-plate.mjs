import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const framing = [
  'Reconstruct the photographed interior as a wide 16:9 architectural photograph of the empty venue after closing time. Use the supplied photograph as the sole visual reference. Preserve the identifiable walls, materials, floorboards, lamps, doorways, furniture and artwork. Clear all people, possessions and screens.',
  'Place the camera at low eye level, looking almost straight down the aisle. The vanishing point is just right of center, about 60 percent across. Keep the left foreground completely vacant, with uninterrupted floor or wall; it is reserved for compositing. Leave the next several floor steps and the central and right approach to a distant illuminated exit clearly visible. Extend the venue through successive recognizable bays.',
  'Use cool blue-green shadows high along the walls and warm pools of light from the remaining practical lamps, with visible detail in the midtones and a readable floor. Furniture stays at the sides. Show only the room, without people, robots, figures, ghosts, newly added obstacles, interface or captions.',
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

class RoomContainsFigure extends Error {}

export async function generatePhotoPlate({ photo, captureDir }) {
  const sdk = createRequire(resolve(captureDir, 'package.json'))(
    '@google/genai',
  );
  const key =
    process.env.GEMINI_API_KEY ||
    parseEnv(readFileSync(process.env.PG_WORLD_ENV_FILE || resolve(captureDir, '../../../.env'), 'utf8'))
      .GEMINI_API_KEY;
  if (!key) throw Error('The room generator is unavailable.');
  const ai = new sdk.GoogleGenAI({ apiKey: key });
  return generateVerifiedRoom(photo, ai.models);
}

export async function generateVerifiedRoom(photo, models) {
  const result = await models.generateContent({
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
          { text: framing },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
    },
  });
  const image = generatedImage(result);
  await checkEmptyRoom(image, models);
  return image;
}

export async function checkEmptyRoom(image, models) {
  const review = await models.generateContent({
    model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview',
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } },
      { text: 'Inspect the entire hallway image, particularly the left foreground and distant aisle. Is there any freestanding character such as a robot, person or ghost? Count even partial heads, shoulders, silhouettes, and reflections of characters. Furniture, light fixtures and flat original wall art are part of the room. Choose empty only when confidently free of characters. Otherwise choose character or uncertain.' },
    ] }],
    config: {
      temperature: 0,
      httpOptions: { apiVersion: 'v1beta', timeout: 14000 },
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { room: { type: 'string', enum: ['empty', 'character', 'uncertain'] } },
        required: ['room'],
      },
    },
  });
  const verdict = JSON.parse(review.text || '{}')?.room;
  if (verdict !== 'empty') throw new RoomContainsFigure('Room check: ' + (verdict || 'uncertain'));
}

// Jobs and completed plates share one entry keyed by the exact source, so reloads,
// duplicate clicks and switching photos cannot pay for or publish the wrong room.
export function createPlateCache({
  captureDir,
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
        .then(() => generate({ photo, captureDir }))
        .then((image) => {
          entry.image = image;
        })
        .catch((error) => {
          entry.error = error instanceof RoomContainsFigure
            ? 'We couldn’t confirm the hallway is empty. Prepare the photo again.'
            : 'The room could not be prepared. Try again.';
        })
        .finally(() => {
          entry.pending = false;
        });
      return entry;
    },
  };
}
