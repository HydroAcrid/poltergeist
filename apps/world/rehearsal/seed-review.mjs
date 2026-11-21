import { venueVisionModels } from './photo-plate.mjs';

export async function reviewPlayerSeed(bytes, captureDir, models = venueVisionModels(captureDir)) {
  const result = await models.generateContent({
    model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview',
    contents: [{ role: 'user', parts: [
      {inlineData: {mimeType: 'image/jpeg', data: bytes.toString('base64')}},
      {text: 'Count every distinct player robot visible in this single opening frame. Inspect both the near foreground and the distant room, including partial silhouettes or reflections. Ignore flat artwork and furniture. Is the single player close on the left with its back and backpack toward us, seen from behind its right shoulder, with open walking space visible beyond the right shoulder? Use uncertain when the evidence is ambiguous.'},
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
        }, required: ['playerCount', 'view', 'routeVisible'],
      },
    },
  });
  const evidence = JSON.parse(result.text);
  return {...evidence, passes: evidence.playerCount === 1 && evidence.view === 'right-shoulder' && evidence.routeVisible === true};
}
