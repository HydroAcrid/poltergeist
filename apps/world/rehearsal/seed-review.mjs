import { shoulderFrame } from './look.mjs';
import { venueVisionModels } from './photo-plate.mjs';

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
