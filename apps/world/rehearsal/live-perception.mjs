import playerMoves from '../../brain/server/perception/player-moves.json' with { type: 'json' };

// Each live interaction owns its own Gemini client. Retain just its previous observation.
const previousFrames = new WeakMap();

// This call receives only pixels and the navigation task. Audience submissions stay in World.
export async function inspectRoom(ai, image, signal, playerReference, assessingEncounter = false, lastStep = null) {
  const point = {
    type: 'array',
    items: { type: 'integer' },
    minItems: 2,
    maxItems: 2,
  };
  const model = process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview';
  const directions={A:'sidestep left',D:'sidestep right',S:'step backward',W:'walk forward',ArrowLeft:'turn left',ArrowRight:'turn right'};
  const outcomes={
    'awaiting-pixels':'Check whether the instructed movement actually happened.',
    'still-blocked':'The last checked frame still showed the obstacle in the next stride.',
    'backed-away':'The last check showed increased distance from the obstacle.',
    'route-open':'The last check showed the original obstruction outside the new walking line.',
    unconfirmed:'The previous check could not confirm the result.',
  };
  const sent = lastStep && directions[lastStep.key];
  const previous = sent ? lastStep.basisImage : previousFrames.get(ai);
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          ...(playerReference ? [
            { text: 'Character reference only. Use its helmet, orange backpack and flashlight to recognize the persistent player. The reference is outside the world; exclude it from every count and coordinate.' },
            { inlineData: { mimeType: 'image/webp', data: playerReference } },
          ] : []),
          ...(previous ? [
            { text: sent ? 'Live image used to choose the last step, before any instruction was sent.' : 'Previous live observation, for motion comparison only.' },
            { inlineData: {mimeType: 'image/jpeg', data: previous} },
          ] : []),
          { text: 'Live world frame. Inspect and count actors ONLY in the following picture.' },
          { inlineData: { mimeType: 'image/jpeg', data: image } },
          { text: [
            'You control the single player. Reach the signed exit. Compare the current view to the previous observation when supplied.',
            playerMoves.guidance,
            ...(sent ? [`The last movement actually sent to the player was to ${sent}, then pause. ${outcomes[lastStep.outcome] || outcomes.unconfirmed} Compare boot contact, the obstacle, and fixed floor marks in the two images. Choose a new safe response based on visible movement and the route now available. The instruction itself is not evidence of a successful move.`] : []),
            ...(assessingEncounter ? ['With the explorer stopped, compare the next footsteps to the previous picture. Choose how to respond to what is visibly in its way, whether to wait for motion, look, back away, sidestep onto clear floor, or deliberately cross a harmless effect. Mark avoiding true when this choice responds to what you see.'] : []),
            'For each floor obstacle judge whether it is solid enough to block a step. Give your chosen intent, target floor point, a short reason, whether you are avoiding something, and the visible change since the previous frame.',
          ].join(' ') },
          {
            text: 'Count all separate versions of the player in the live frame, including a second robot farther down the aisle. Check whether the visible foreground character matches the reference when provided. Classify the camera as rear-right only if the backpack and right flank are both visible from behind; a face-on or pure profile view is other. Independently classify the physical aisleHeading from floor seams and furniture: diagonal-right when the path leads into depth from the lower-left player toward the upper right; head-on for a centered straight-ahead tunnel, diagonal-left for the opposite diagonal, side-on for a horizontal side-scroller, or unclear if occluded. Use the hallway direction, even while the robot temporarily turns its flashlight to inspect something. If two separate matching robots are visible, report playerCount=2. Exclude unrelated toys, wall art and reflections. Locate the player and the passable signed exit. Coordinates are [y,x] integers 0–1000. Return the tight VISIBLE silhouette bodyBox [top,left,bottom,right], and upperBodyBox around head, shoulders and backpack only. Indicate feetVisible only when both boots visibly touch the floor; when cropped use [0,0] placeholders for left and right. In a wider diagonal trailing shot both boots can be visible. Measure them when visible; leave them unknown when either boot is obscured. goal is the centre of the doorway at FLOOR level. If the robot or goal is hidden, say so. For doorwayProgress use at-threshold only when the passable signed doorway or its sill is visibly close at the bottom edge under the player. Use through only when the near jamb/sill visibly passes beside or behind the camera and the space beyond the doorway is now occupied. Otherwise use approaching or unclear. A distant exit sign is insufficient. If visible, give ahead as a floor point one or two strides in front of the robot in the direction its body and flashlight face. Set rightFloorVisible only if floor for the next few steps is visible ahead of the player in the right-hand lane. An obstacle can occupy part of this visible lane. List clearly visible floor obstacles, furniture and people ahead, plus localized visible effects crossing the lane such as a swirl of papers or a bank of fog. Give each a descriptive common name and bounds [top,left,bottom,right]. For each obstacle mark its relation to the robot: crossing for a moving airborne effect visibly intersecting the next step or the body’s forward path, noticeable for a distinct eye-catching movement beside the robot within its field of view, otherwise ordinary. Stationary room furniture is ordinary. Only list what is visible. Report stumbling only for an actual visible loss of balance. Use startled only for a clearly visible recoil or both boots making a short hop. A pause, a normal walk or a turn is upright. Report threat as startling only for a clearly visible sudden alarming motion or threatening obstacle directly on the next footsteps. An ordinary chair is ordinary. Use unclear if uncertain. Do not infer a scare from an obstacle.',
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
          intent: {type:'string', enum:playerMoves.intents},
          change: {type:'string'}, reason: {type:'string'}, avoiding: {type:'boolean'}, target: point,
          playerCount: { type: 'integer', minimum: 0, maximum: 2 },
          robotVisible: { type: 'boolean' },
          playerMatch: { type: 'boolean' },
          shoulderView: { type: 'string', enum: ['rear-right', 'other', 'unclear'] },
          aisleHeading: {type:'string',enum:['diagonal-right','head-on','diagonal-left','side-on','unclear']},
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
                solid: {type:'boolean'},
                relation: { type: 'string', enum: ['crossing', 'noticeable', 'ordinary'] },
                box: {
                  type: 'array',
                  items: { type: 'integer' },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ['label', 'box', 'relation', 'solid'],
            },
          },
        },
        required: [
          'intent', 'change', 'reason', 'avoiding', 'playerCount', 'robotVisible', 'playerMatch', 'shoulderView', 'aisleHeading',
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
  previousFrames.set(ai, image);
  const validBox = (b) => valid(b,4) && b[0]<b[2] && b[1]<b[3];
  const feetVisible = v.feetVisible && valid(v.left,2) && valid(v.right,2);
  const identity = { playerCount: v.playerCount, playerMatch: v.playerMatch === true, shoulderView: v.shoulderView, aisleHeading: v.aisleHeading ?? 'unclear' };
  if (v.playerCount !== 1 || !identity.playerMatch || !v.robotVisible || !validBox(v.bodyBox))
    return { visible: false, ...identity, obstacles: [] };
  const centre = validBox(v.bodyBox) ? Math.round((v.bodyBox[1]+v.bodyBox[3])/2) : 0;
  // Ground-plane projection only. Never publish these estimates as observed boot positions.
  const feet = feetVisible ? {left:v.left, right:v.right} : {
    left:[1000,Math.max(0,centre-20)], right:[1000,Math.min(1000,centre+20)],
  };
  return {
    move: playerMoves.intents.includes(v.intent) ? {
      intent: v.intent, target: valid(v.target, 2) ? v.target : undefined,
      reason: String(v.reason || '').slice(0, 60), observed: String(v.change || '').slice(0, 80),
      avoiding: v.avoiding === true, robotCount: v.playerCount,
    } : undefined,
    visible: true, ...identity, feetVisible: Boolean(feetVisible), feet,
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
      .map(({ label, box, relation, solid }) => ({
        solid: solid !== false,
        relation,
        label: String(label).slice(0, 30),
        box,
        point: [box[2], Math.round((box[1] + box[3]) / 2)],
      })),
  };
}
