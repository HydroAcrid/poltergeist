// This call receives only pixels and the navigation task. Audience submissions stay in World.
export async function inspectRoom(ai, image, signal) {
  const point = {
    type: 'array',
    items: { type: 'integer' },
    minItems: 2,
    maxItems: 2,
  };
  const response = await ai.models.generateContent({
    model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: image } },
          {
            text: 'Locate the small flashlight robot and the passable signed exit in this image. Coordinates are [y,x] integers 0–1000. Return each boot touching the floor. goal is the centre of the doorway at FLOOR level. If the robot or goal is hidden, say so. List only clearly visible freestanding obstacles, furniture or people on the walkable floor ahead, their common name and bounding box [top,left,bottom,right]. Report stumbling only for an actual visible loss of balance. A normal walking pose or a turn is upright. Do not infer a scare from an obstacle.',
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      httpOptions: { timeout: 14000 },
      temperature: 0,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          robotVisible: { type: 'boolean' },
          goalVisible: { type: 'boolean' },
          left: point,
          right: point,
          goal: point,
          pose: { type: 'string', enum: ['upright', 'stumbling'] },
          obstacles: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                box: {
                  type: 'array',
                  items: { type: 'integer' },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ['label', 'box'],
            },
          },
        },
        required: [
          'robotVisible',
          'goalVisible',
          'left',
          'right',
          'goal',
          'pose',
          'obstacles',
        ],
      },
    },
  });
  const v = JSON.parse(response.text),
    valid = (p, n) =>
      Array.isArray(p) &&
      p.length === n &&
      p.every((c) => Number.isInteger(c) && c >= 0 && c <= 1000);
  if (!v.robotVisible || !valid(v.left, 2) || !valid(v.right, 2))
    return { visible: false, obstacles: [] };
  return {
    visible: true,
    feet: { left: v.left, right: v.right },
    ...(v.goalVisible && valid(v.goal, 2) ? { goal: v.goal } : {}),
    pose: v.pose,
    obstacles: v.obstacles
      .filter(
        (o) => valid(o.box, 4) && o.box[0] <= o.box[2] && o.box[1] <= o.box[3],
      )
      .map(({ label, box }) => ({
        label: String(label).slice(0, 30),
        box,
        point: [box[2], Math.round((box[1] + box[3]) / 2)],
      })),
  };
}
