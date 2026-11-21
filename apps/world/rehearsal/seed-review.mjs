import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shoulderFrame } from './look.mjs';
import { photoKey, venueVisionModels } from './photo-plate.mjs';

export async function reviewPlayerSeed(bytes, captureDir, models = venueVisionModels(captureDir)) {
  const result = await models.generateContent({
    model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview',
    contents: [{ role: 'user', parts: [
      {inlineData: {mimeType: 'image/jpeg', data: bytes.toString('base64')}},
      {text: 'Inspect the opening game frame. Count every robot, including cropped or reflected characters. Return the single explorer’s visible silhouette box [top,left,bottom,right] in 0–1000 image coordinates. Classify viewpoint using the body: right-shoulder means both the back of its backpack and its right flank are visible, with the viewer behind and to its right. A wider three-quarter tracking view qualifies. A frontal, pure side, or rear-left view is other. Judge independently of camera distance and which way the helmet is turned. Does the walking lane run diagonally from its lower-left position toward the right distance? Can an audience see at least two connected strides of floor ahead of the explorer, with enough space for an entire chair-sized obstacle and time to see it coming? Verify the explorer stands on clear floor. If a chair or table intersects its feet or supports its body, set standingOnFloor to false. Furniture behind or beside the explorer does not qualify as walking space. Use uncertain for an ambiguous viewpoint.'},
    ]}],
    config: {
      temperature: 0,
      httpOptions: {apiVersion: 'v1beta', timeout: 20000},
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object', properties: {
          playerCount: {type: 'integer'},
          view: {type: 'string', enum: ['right-shoulder', 'other', 'uncertain']},
          routeVisible: {type: 'boolean'},
          diagonal: {type: 'boolean'},
          standingOnFloor: {type: 'boolean'},
          bodyBox: {type:'array', items:{type:'integer'}, minItems:4, maxItems:4},
        }, required: ['playerCount', 'view', 'routeVisible', 'diagonal', 'standingOnFloor', 'bodyBox'],
      },
    },
  });
  const evidence = JSON.parse(result.text);
  return {...evidence, passes: audienceCanSeeApproach(evidence)};
}

export function audienceCanSeeApproach({playerCount, view, routeVisible, diagonal, standingOnFloor, bodyBox}) {
  if (playerCount !== 1 || view !== 'right-shoulder' || routeVisible !== true || diagonal !== true || standingOnFloor !== true) return false;
  if (!Array.isArray(bodyBox) || bodyBox.length !== 4 ||
      !bodyBox.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) return false;
  const [top,left,bottom,right] = bodyBox;
  const width = (right - left) / 1000;
  const center = (right + left) / 2000;
  return width >= shoulderFrame.width * .78 && width <= shoulderFrame.width * 1.22 &&
    Math.abs(center - shoulderFrame.x) <= .105 && top < 550 && bottom > 770 && bottom - top >= 400;
}

export function reviewedVenueOpening(root, plate) {
  try {
    const receipt = JSON.parse(readFileSync(resolve(root, 'venue-opening.json'), 'utf8'));
    const jpeg = readFileSync(resolve(root, 'venue-opening.jpg'));
    const explorer = readFileSync(resolve(root, 'explorer.webp'));
    if (photoKey(jpeg) === receipt.seedSha256 && photoKey(plate) === receipt.plateSha256 &&
        photoKey(explorer) === receipt.explorerSha256 && audienceCanSeeApproach(receipt.review))
      return {jpeg, digest: receipt.seedSha256};
  } catch { /* A build without a matching receipt uses the normal camera review. */ }
  return null;
}

export function openingCorrection(review) {
  if (review.playerCount !== undefined && review.playerCount !== 1)
    return 'The opening needs exactly one robot. Use the venue photo or choose a hallway without figures or reflections.';
  if (review.standingOnFloor === false)
    return 'Furniture overlaps the robot’s feet. Use the venue photo or choose a hallway with clear foreground floor.';
  if (review.view && review.view !== 'right-shoulder')
    return 'The camera could not confirm the robot’s right shoulder. Use the venue photo or choose a view angled down the aisle.';
  if (review.routeVisible === false || review.diagonal === false)
    return 'The opening needs two clear strides ahead and to the right. Use the venue photo or choose a view with more open floor.';
  return 'The opening needs the robot on the left with room for an obstacle on the right. Use the venue photo or choose a wider hallway view.';
}
