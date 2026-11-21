export const cameraPrompt = [
  'Third-person gameplay inside the photographed lounge. A compact sage-metal biped with an orange backpack stands on the open wood floor.',
  'Keep the camera above and behind its RIGHT shoulder. Show the right side of its head and arm, with its backpack and feet left of center.',
  'Follow from this same offset. Its boots step on the floor when movement controls are applied. The walls, furnishings and people stay in place.',
].join(' ');

const chairPrompt = 'One bright yellow full-size wooden cafe chair now stands sideways on all four legs in the middle of the wooden walkway directly in front of the robot, one short step from its feet. Its seat and back clearly block the robot’s straight path. The single chair stays still and solid. Preserve the over-right-shoulder view of both robot and chair.';
const directions = { forward: 'key_w', left: 'key_a', right: 'key_d', backward: 'key_s' };

export function cameraPilot({ ai, model, send, record, finish, fail, signal, chairTest, gameRound = false, isActive = () => true }) {
  let nextObservation = 43;
  let held, releaseFrame, injectionStart;
  let pending = false, finished = false;
  let exitSeen = false;
  let frame = 0;
  const decisions = [];

  async function decide(image) {
    const observed = frame;
    const prior = decisions.at(-1);
    const prompt = [
      'Drive the robot toward the far end of the open wooden aisle. The camera is behind the robot. The JPEG is the latest live observation.',
      'Inspect the floor immediately within one robot step of its feet. Furniture and people are solid. Do not step through them. Identify the closest obstacle in the forward path or say clear. Objects off to the sides do not necessarily block forward travel.',
      'Arrival means both boots are visibly beyond the doorway beneath the exit sign. Seeing the sign or approaching it is insufficient. Set pastExit only when the feet have crossed.',
      'For each direction classify the landing space as clear, blocked, or unseen. Choose a single move based on that evidence. If no useful landing space is visible, wait. Give a brief concrete description of what you see. Report whether you see the robot.',
      prior ? 'The preceding command was ' + prior + '. This image was taken after it ended. Reassess the current path.' : 'This is your first observation.',
    ].join(' ');
    const clearance = {type:'string',enum:['clear','blocked','unseen']};
    const response = await ai.models.generateContent({
      model, contents: [{role:'user',parts:[{inlineData:{mimeType:'image/jpeg',data:image}},{text:prompt}]}],
      config: {httpOptions:{timeout:14000}, abortSignal:signal, temperature:0, maxOutputTokens:950,
        responseMimeType:'application/json', responseJsonSchema:{
          type:'object', properties:{
            clearance:{type:'object',properties:Object.fromEntries(Object.keys(directions).map(key=>[key,clearance])),required:Object.keys(directions)},
            forwardObstacle:{type:'string'},robotVisible:{type:'boolean'},pastExit:{type:'boolean'},
            move:{type:'string',enum:[...Object.keys(directions),'wait']},reason:{type:'string'},
          }, required:['clearance','forwardObstacle','robotVisible','pastExit','move','reason'],
        }},
    });
    if (signal.aborted || finished || !isActive()) return;
    const decision = JSON.parse(response.text);
    if ((!Object.hasOwn(directions,decision.move) && decision.move !== 'wait') || !decision.clearance || typeof decision.reason !== 'string') throw Error('Gemini returned an invalid movement decision.');
    const beyond = gameRound && decision.robotVisible === true && decision.pastExit === true;
    if (beyond && exitSeen) {
      finished = true;
      record('Exit crossing confirmed', {observed, model});
      await finish('robot');
      return;
    }
    exitSeen = beyond;
    const move = !beyond && decision.clearance[decision.move] === 'clear' ? decision.move : 'wait';
    held = directions[move] || 'wait';
    if (move !== 'wait') await send({event_type:'user_action',action:'key_down',input:held});
    decisions.push(move);
    record('Gemini move ' + decisions.length, {observed,model,...decision,applied:move,input:held});
    releaseFrame = frame + 18;
    pending = false;
  }

  return async (number,image) => {
    frame = number;
    if (signal.aborted || finished || !isActive()) return;
    if (frame === 4 && !chairTest && !gameRound) {
      await send('Track the robot from just behind its right shoulder. Keep its whole body and the path visible.');
      record('Requested right-shoulder tracking');
    }
    if (held && frame >= releaseFrame) {
      if (held !== 'wait') await send({event_type:'user_action',action:'key_up',input:held});
      record(held === 'wait' ? 'Finished waiting' : 'Released ' + held);
      held = undefined;
      if (chairTest && decisions.length === 1) injectionStart=frame;
      nextObservation = frame + (injectionStart === frame ? 80 : 28);
    }
    if (injectionStart !== undefined && frame-injectionStart <= 24 && (frame-injectionStart)%4 === 0) {
      await send(chairPrompt);
      if (frame === injectionStart) record('Audience requested a chair in the path', {prompt:chairPrompt});
    }
    if (pending || held || frame < nextObservation) return;
    if (!gameRound && decisions.length === 2) {
      finished=true;
      record('Recorded the result of move 2');
      await finish();
      return;
    }
    pending=true;
    decide(image).catch(fail);
  };
}
