// This call receives only pixels and the navigation task. Audience submissions stay in World.
export async function inspectRoom(ai, image, signal) {
  const point = {
    type: 'array',
    items: { type: 'integer' },
    minItems: 2,
    maxItems: 2,
  };
  const model = process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview';
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: image } },
          {
            text: 'Locate the small flashlight robot and the passable signed exit in this image. Coordinates are [y,x] integers 0–1000. Return the tight VISIBLE silhouette bodyBox [top,left,bottom,right], and upperBodyBox around head, shoulders and backpack only. Indicate feetVisible only when both boots visibly touch the floor; when cropped use [0,0] placeholders for left and right. The camera trails close over its right shoulder; the knees and boots often fall below frame. goal is the centre of the doorway at FLOOR level. If the robot or goal is hidden, say so. For doorwayProgress use at-threshold only when the passable signed doorway or its sill is visibly close at the bottom edge under the player. Use through only when the near jamb/sill visibly passes beside or behind the camera and the space beyond the doorway is now occupied. Otherwise use approaching or unclear. A distant exit sign is insufficient. If visible, give ahead as a floor point one or two strides in front of the robot in the direction its body and flashlight face. Set rightFloorVisible only if the next few steps of its floor lane on the RIGHT are in view. List clearly visible floor obstacles, furniture and people ahead, plus localized visible effects crossing the lane such as a swirl of papers or a bank of fog. Give each a descriptive common name and bounds [top,left,bottom,right]. For each obstacle mark its relation to the robot: crossing for a moving airborne effect visibly intersecting the next step or the body’s forward path, noticeable for a distinct eye-catching movement beside the robot within its field of view, otherwise ordinary. Stationary room furniture is ordinary. Only list what is visible. Report stumbling only for an actual visible loss of balance. Use startled only for a clearly visible recoil or both boots making a short hop. A pause, a normal walk or a turn is upright. Report threat as startling only for a clearly visible sudden alarming motion or threatening obstacle directly on the next footsteps. An ordinary chair is ordinary. Use unclear if uncertain. Do not infer a scare from an obstacle.',
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      httpOptions: { timeout: 14000 },
      temperature: 0,
      ...(model === 'gemini-robotics-er-2-preview' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          robotVisible: { type: 'boolean' },
          goalVisible: { type: 'boolean' },
          rightFloorVisible: {type:'boolean'},
          feetVisible: {type:'boolean'},
          doorwayProgress: {type:'string',enum:['approaching','at-threshold','through','unclear']},
          upperBodyBox: {type:'array',items:{type:'integer'},minItems:4,maxItems:4},
          bodyBox: {type:'array',items:{type:'integer'},minItems:4,maxItems:4},
          threat: { type: 'string', enum: ['startling', 'ordinary', 'unclear'] },
          left: point,
          right: point,
          goal: point,
          ahead: point,
          pose: { type: 'string', enum: ['upright', 'stumbling', 'startled'] },
          obstacles: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                relation: { type: 'string', enum: ['crossing', 'noticeable', 'ordinary'] },
                box: {
                  type: 'array',
                  items: { type: 'integer' },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ['label', 'box', 'relation'],
            },
          },
        },
        required: [
          'robotVisible',
          'goalVisible',
          'rightFloorVisible',
          'bodyBox', 'upperBodyBox', 'feetVisible', 'doorwayProgress',
          'threat',
          'left',
          'right',
          'goal',
          'ahead',
          'pose',
          'obstacles',
        ],
      },
    },
  });
  const payload = response.text || '';
  if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw Error('Vision response truncated');
  const v = JSON.parse(payload),
    valid = (p, n) =>
      Array.isArray(p) &&
      p.length === n &&
      p.every((c) => Number.isInteger(c) && c >= 0 && c <= 1000);
  const validBox = (b) => valid(b,4) && b[0]<b[2] && b[1]<b[3];
  const feetVisible = v.feetVisible && valid(v.left,2) && valid(v.right,2);
  if (!v.robotVisible || (!feetVisible && !validBox(v.bodyBox)))
    return { visible: false, obstacles: [] };
  const centre = validBox(v.bodyBox) ? Math.round((v.bodyBox[1]+v.bodyBox[3])/2) : 0;
  // Ground-plane projection only. Never publish these estimates as observed boot positions.
  const feet = feetVisible ? {left:v.left, right:v.right} : {
    left:[1000,Math.max(0,centre-20)], right:[1000,Math.min(1000,centre+20)],
  };
  return {
    visible: true, feetVisible: Boolean(feetVisible), feet,
    doorwayProgress: v.doorwayProgress,
    ...(validBox(v.bodyBox) ? {bodyBox:v.bodyBox} : {}),
    ...(validBox(v.upperBodyBox) ? {upperBodyBox:v.upperBodyBox} : {}),
    threat: ['startling','ordinary'].includes(v.threat) ? v.threat : 'unclear',
    rightFloorVisible: v.rightFloorVisible===true,

    ...(valid(v.ahead,2)?{ahead:v.ahead}:{}),
    ...(v.goalVisible && valid(v.goal, 2) ? { goal: v.goal } : {}),
    pose: v.pose,
    obstacles: v.obstacles
      .filter(
        (o) => valid(o.box, 4) && o.box[0] <= o.box[2] && o.box[1] <= o.box[3],
      )
      .map(({ label, box, relation }) => ({
        relation,
        label: String(label).slice(0, 30),
        box,
        point: [box[2], Math.round((box[1] + box[3]) / 2)],
      })),
  };
}
