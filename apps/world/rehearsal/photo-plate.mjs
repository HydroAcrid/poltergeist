import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const framing = [
  'Reconstruct the photographed interior as a wide 16:9 architectural photograph of the empty venue after closing time. Use the supplied photograph as the sole visual reference. Preserve the identifiable walls, materials, floorboards, lamps, doorways and wall art. Clear all people, possessions and screens.',
  'Move the viewpoint several steps sideways and up, as if looking down from a camera behind and to the right of a small walking character. Create a pronounced diagonal composition: an empty walking lane ENTERS at the bottom LEFT near x=20%, crosses open floor at picture center, and recedes to a far opening on the upper RIGHT near x=75%, y=40%. The camera looks down at the floor enough for the audience to see a whole chair-sized obstacle two or three strides ahead. The lower half is mostly visible wood floor, the ceiling occupies at most the top quarter. Preserve the near left foreground for the explorer. Place the camera INSIDE the aisle, three steps beyond the nearest seats. The entire bottom half, from the lower LEFT corner through the center and right, must be uninterrupted empty wood flooring. All tables, stools, chairs and other furniture are beyond the starting position or outside the image. The lower-left quarter will contain the standing player; any chair, desk or pillar there ruins the shot. Fill most of the lower two-thirds with continuous clear floor, extending diagonally into successive recognizable bays. Compose the scene with level verticals.',
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

export function venueVisionClient(captureDir) {
  const sdk = createRequire(resolve(captureDir, 'package.json'))(
    '@google/genai',
  );
  const key =
    process.env.GEMINI_API_KEY ||
    parseEnv(readFileSync(process.env.PG_WORLD_ENV_FILE || resolve(captureDir, '../../../.env'), 'utf8'))
      .GEMINI_API_KEY;
  if (!key) throw Error('The room generator is unavailable.');
  return new sdk.GoogleGenAI({ apiKey: key, apiVersion: 'v1beta' });
}

export function venueVisionModels(captureDir) {
  return venueVisionClient(captureDir).models;
}

export async function generatePhotoPlate({photo, captureDir}) {
  return generateVerifiedRoom(photo, venueVisionModels(captureDir));
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
  const aisle = await checkEmptyRoom(image, models);
  if (aisle) image.aisle = aisle;
  return image;
}

export async function checkEmptyRoom(image, models) {
  const review = await models.generateContent({
    model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview',
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } },
      { text: 'Inspect the entire hallway image, particularly the left foreground and distant aisle. Is there any freestanding character such as a robot, person or ghost? Count even partial heads, shoulders, silhouettes, and reflections of characters. Furniture, light fixtures and flat original wall art are part of the room. Choose empty only when confidently free of characters. Otherwise choose character or uncertain. Locate the far end or vanishing point of the main walkable aisle as aisleEnd [y,x] normalized from 0 to 1000.' },
    ] }],
    config: {
      temperature: 0,
      httpOptions: { apiVersion: 'v1beta', timeout: 14000 },
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { room: { type: 'string', enum: ['empty', 'character', 'uncertain'] }, aisleEnd:{type:'array',items:{type:'integer'},minItems:2,maxItems:2} },
        required: ['room','aisleEnd'],
      },
    },
  });
  const {room:verdict, aisleEnd} = JSON.parse(review.text || '{}');
  if (verdict !== 'empty') throw new RoomContainsFigure('Room check: ' + (verdict || 'uncertain'));
  if (Array.isArray(aisleEnd) && aisleEnd.length === 2 &&
      aisleEnd.every(n => Number.isInteger(n) && n > 0 && n < 1000))
    return {y:aisleEnd[0]/1000, x:aisleEnd[1]/1000};
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
