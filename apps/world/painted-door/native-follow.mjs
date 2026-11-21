// Measure displacement in native frames. All corrections go to Genie's camera controls.
import jpeg from "jpeg-js";
import { shoulderFrame,validBodyBox } from "./framing-report.mjs";
export { shoulderFrame };
import { placementTarget } from "../rehearsal/placement.mjs";

const width = 112,
  height = 64;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function sampleFrame(bytes, number) {
  const src = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 3 });
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pos =
        4 *
        (Math.floor(((y + 0.5) * src.height) / height) * src.width +
          Math.floor(((x + 0.5) * src.width) / width));
      const i = 3 * (y * width + x);
      pixels[i] = src.data[pos];
      pixels[i + 1] = src.data[pos + 1];
      pixels[i + 2] = src.data[pos + 2];
    }
  return { number, pixels };
}
// Compare the coat/backpack texture in consecutive frames, keeping both color and edges.
function locate(previous, current, anchor) {
  const x = Math.round(anchor.x * width),
    y = Math.round(anchor.y * height);
  const hy = clamp(Math.round(anchor.h * height * 0.18), 2, 7),
    hx = clamp(Math.round(hy * 0.74), 2, 5);
  if (x < hx + 1 || x > width - hx - 2 || y < hy + 1 || y > height - hy - 2)
    return { ...anchor, known: false };
  let best = Infinity,
    bx = x,
    by = y;
  for (
    let yy = Math.max(hy + 1, y - 6);
    yy <= Math.min(height - hy - 2, y + 6);
    yy++
  ) {
    for (
      let xx = Math.max(hx + 1, x - 11);
      xx <= Math.min(width - hx - 2, x + 11);
      xx++
    ) {
      let cost = 0,
        count = 0;
      for (let oy = -hy; oy <= hy; oy += 2)
        for (let ox = -hx; ox <= hx; ox += 2) {
          let old = 3 * ((y + oy) * width + x + ox),
            next = 3 * ((yy + oy) * width + xx + ox);
          for (let c = 0; c < 3; c++) {
            cost += Math.abs(
              previous.pixels[old + c] - current.pixels[next + c],
            );
            count++;
          }
        }
      cost = cost / count + 0.25 * Math.abs(x - xx) + 0.3 * Math.abs(y - yy);
      if (cost < best) {
        best = cost;
        bx = xx;
        by = yy;
      }
    }
  }
  const seconds = Math.max(1 / 24, (current.number - previous.number) / 24);
  const mix = 1 - Math.exp(-seconds / 0.38);
  const vx =
    (1 - mix) * anchor.vx +
    mix * clamp((bx / width - anchor.x) / seconds, -0.6, 0.6);
  const dy = by / height - anchor.y;
  return {
    ...anchor,
    x: bx / width,
    y: by / height,
    top: anchor.top + dy,
    bottom: anchor.bottom + dy,
    vx,
    known: anchor.known && best < 42,
  };
}

// Compare the outline and texture at both ends of a short, tracked baseline.
// A near tie between scales gives no range evidence. Use bilinear samples
// because a quiet walking step often moves the small silhouette by less than one pixel.
function localScale(start, end) {
  const a = start.track,
    b = end.track;
  if (!a?.known || !b?.known || a.h * height < 8) return null;
  function value(frame, x, y, c) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    if (ix < 0 || iy < 0 || ix >= width - 1 || iy >= height - 1) return 0;
    const i = 3 * (iy * width + ix) + c,
      p = frame.pixels;
    return (
      (1 - fy) * ((1 - fx) * p[i] + fx * p[i + 3]) +
      fy * ((1 - fx) * p[i + 3 * width] + fx * p[i + 3 * width + 3])
    );
  }
  const points = [];
  let min = 255,
    max = 0;
  for (let row = -4; row <= 4; row++) {
    for (let col = -2; col <= 2; col++) {
      const dx = col * 0.13 * a.h * height,
        dy = row * 0.105 * a.h * height;
      const rgb = [0, 1, 2].map((c) =>
        value(start, a.x * width + dx, a.y * height + dy, c),
      );
      min = Math.min(min, rgb[1]);
      max = Math.max(max, rgb[1]);
      points.push({ dx, dy, rgb });
    }
  }
  if (max - min < 28) return null;
  let unit = Infinity,
    best = Infinity,
    ratio = 1;
  for (const scale of [0.78, 0.85, 0.92, 1, 1.08, 1.16, 1.24]) {
    let cost = Infinity;
    for (const tx of [-0.8, 0, 0.8])
      for (const ty of [-0.8, 0, 0.8]) {
        let err = 0;
        for (const { dx, dy, rgb } of points)
          for (let c = 0; c < 3; c++)
            err += Math.abs(
              rgb[c] -
                value(
                  end,
                  b.x * width + dx * scale + tx,
                  b.y * height + dy * scale + ty,
                  c,
                ),
            );
        cost = Math.min(cost, err / (points.length * 3));
      }
    if (scale === 1) unit = cost;
    if (cost < best) {
      best = cost;
      ratio = scale;
    }
  }
  if (best > 34 || unit - best < Math.max(1.1, unit * 0.06)) return null;
  return ratio;
}

// Position and size are fractions of the entire unmodified native image.
// Left-third composition leaves the diagonal aisle open on the flashlight side.
export function mustStopTravel(subject) {
  return (
    !subject.known ||
    subject.lost ||
    !subject.grounded ||
    subject.distanceHeld ||
    subject.x < 0.055 ||
    subject.x > 0.94
  );
}
// Release a live key immediately even when vision has not yet explicitly called the robot lost.
export async function holdIfUntracked(subject, releaseCamera, stopActor) {
  if (!mustStopTravel(subject)) return false;
  await Promise.all([releaseCamera(), stopActor()]);
  return true;
}
export function receding(subject) {
  return (
    !mustStopTravel(subject) &&
    subject.clearLane === true &&
    subject.rangeTrend === true &&
    subject.scale < .965 &&
    subject.localRatio !== null &&
    subject.localRatio < 0.965
  );
}
// Use the 24 fps media clock as a conservative watermark. During the penguin
// rehearsal Genie delivered many pre-command frames while closing the stream.
export function createMoveWindow(fps) {
  let firstFrameAt, earliestObservation = 0;
  const mediaFrameAt = (at) => 1 + Math.floor(Math.max(0, at - firstFrameAt) * fps / 1000);
  function settle(frame, at, seconds) {
    if (firstFrameAt === undefined) return;
    earliestObservation = Math.max(earliestObservation,
      Math.max(frame, mediaFrameAt(at)) + Math.ceil(seconds * fps));
  }
  return {
    start(at) { firstFrameAt ??= at; },
    settle,
    accept(command, subject, frame, at) {
      if (firstFrameAt === undefined || mustStopTravel(subject) ||
          !Number.isInteger(command.observed) || command.observed !== subject.observed ||
          command.observed < earliestObservation || command.observed > frame) return false;
      // Beyond the framing report's four-second gap, a fresh visual decision
      // is unverified even if its vision request just returned.
      if (Math.max(frame, mediaFrameAt(at)) - command.observed > 4 * fps) return false;
      // A turn needs half a second of subsequent motion; a full stride needs a second.
      settle(frame, at, command.key.startsWith('Arrow') ? .5 : 1);
      return true;
    },
  };
}

// A short native camera stride starts with the committed walking instruction.
// Motion-based corrections can still catch up later when framing actually drifts.
export function shoulderStride(subject) {
  if (mustStopTravel(subject) || !subject.clearLane || subject.scale > 1.14 ||
      subject.scale < .65 || subject.vh > .10 || subject.top < .07 ||
      Math.abs(subject.x - shoulderFrame.x) > .12) return null;
  return { key: 'key_w', ms: 160, reason: 'match forward stride' };
}

export function cameraStep(subject) {
  if (!subject.known || subject.lost || !subject.grounded) return null;
  if (subject.distanceHeld) {
    if (!subject.cameraRecovery) return null;
    // Physically move the observer along the hallway. One pulse per live reading.
    return {key:'key_w', ms:clamp(Math.round((shoulderFrame.width-subject.bodyWidth)*1250),95,265),
      reason:'recover shoulder distance'};
  }
  const { x, scale, vx, vh, top } = subject;
  if (top < 0.045)
    return { key: "arrow_up", ms: 70, reason: "headroom" };
  if (top > .49 && scale>.8)
    return { key: "arrow_down", ms: 70, reason: "shoulder too low" };
  const error = x - shoulderFrame.x;
  const near = scale>1.18 || (scale>1.05 && vh>.05);
  const moving = Math.abs(vx) > 0.021;
  // When the robot is already moving back toward its mark, let it settle.
  const depth = receding(subject);
  const depthStep = depth
    ? {
        key: "key_w",
        ms: clamp(Math.round(145 + (1-scale)*335 - vh*220), 145, 340),
        reason: "right-shoulder follow",
      }
    : null;
  if (moving && error * vx < 0 && Math.abs(error) > 0.025) return depthStep;
  if (!near && moving) {
    const forecast = error + 0.42 * vx;
    if (Math.abs(forecast) > 0.037 && Math.sign(forecast) === Math.sign(vx)) {
      // Keep the lateral component when matching a diagonal stride.
      const rangePace = clamp(-vh / 0.16, -0.28, 0.38);
      const ms = clamp(
        Math.round(
          (52 + 205 * Math.abs(forecast) + 210 * Math.abs(vx)) *
            (1 + rangePace),
        ),
        60,
        185,
      );
      if (depthStep)
        return { ...depthStep, lateralKey: forecast > 0 ? "key_d" : "key_a" };
      return {
        key: forecast > 0 ? "key_d" : "key_a",
        ms,
        reason: "parallel travel",
      };
    }
  }
  if (depthStep) return depthStep;
  if (Math.abs(error) > 0.135 && (!moving || near))
    return {
      key: error > 0 ? "arrow_right" : "arrow_left",
      ms: clamp(Math.round(45 + 125 * Math.abs(error)), 55, 105),
      reason: "small pan",
    };
  return null;
}

export function createNativeFollow() {
  const history = [];
  const neutral = {
    x: 0.22,
    y: 0.65,
    h: shoulderFrame.height,
    vx: 0,
    vh: 0,
    top: 0.44,
    bottom: 0.82,
    known: false,
  };
  let anchor = { ...neutral },
    lastGrounding = -1,
    lastBox = null,
    lastStaticCorrection = -1,
    lastRecovery = -1;
  let distanceHeld = false, approachClear = false, semanticThrough = -1, semanticAnchor = null;
  let nextCamera = 0,
    lost = true,
    rangeTrend = false,
    localRatio = null,
    clearLane = false,
    reacquiring = false,
    holdReason = 'waiting for live subject';
  function suspend(reason) {
    holdReason = reason;
    lost = true;
    reacquiring = true;
    anchor.known = false;
    anchor.vx = 0;
    rangeTrend = false;
    localRatio = null;
    clearLane = false;
  }
  function lose(reason) {
    suspend(reason);
    lastBox = null;
    semanticThrough = -1;
    distanceHeld = false;
    approachClear = false;
  }
  function advance(previous, current) {
    anchor = locate(previous, current, anchor);
    if (!anchor.known) suspend('subject texture lost');
    current.track = { ...anchor };
    const base = history.findLast(
      (frame) =>
        frame.track?.known &&
        frame.number <= current.number - 22 &&
        frame.number >= current.number - 32,
    );
    localRatio = base && anchor.known ? localScale(base, current) : null;
  }
  function push(bytes, number) {
    const frame = sampleFrame(bytes, number),
      prev = history.at(-1);
    if (prev && number <= prev.number) return;
    if (lastGrounding >= 0 && number-lastGrounding > 24*4) {
      semanticThrough = -1;
      suspend('stale observation');
    }
    if (prev && anchor.known) advance(prev, frame);
    history.push(frame);
    // Keep more than ER2's request timeout to align each delayed measurement
    // with its source frame before bringing the body forward to the current one.
    while (history.length > 1 && history[0].number < number - 24 * 16)
      history.shift();
  }
  function observe(scene, number) {
    if (number <= lastGrounding) return;
    if (
      !history.length ||
      number < history[0].number ||
      number > history.at(-1).number + 4
    )
      return;
    const match = history.findIndex((f) => f.number >= number);
    const index = match < 0 ? history.length - 1 : match;
    lastGrounding = number;
    if (history.at(-1).number-number > 24*4) { semanticThrough=-1; suspend('stale observation'); return; }
    if (scene.playerCount !== 1 || !scene.visible || !scene.playerMatch || scene.shoulderView !== 'rear-right') {
      lose(scene.playerCount > 1 ? 'duplicate players' : !scene.visible || !scene.playerMatch ? 'identity unconfirmed' : 'shoulder view unconfirmed');
      return;
    }
    const upper=validBodyBox(scene.upperBodyBox);
    const b=upper ? scene.upperBodyBox : scene.bodyBox;
    if (!validBodyBox(scene.bodyBox)) { lose('body unlocated'); return; }
    const [top, left, bottom, right] = scene.bodyBox;
    const bodyWidth = (right-left)/1000, bodyX = (right+left)/2000;
    const prior=lastBox && number-lastBox.number<=24*4 ? lastBox : null;
    const continuous = prior && Math.abs(bodyX-prior.bodyX)<.15 &&
      bodyWidth/prior.bodyWidth>=.6 && bodyWidth/prior.bodyWidth<=1.65;
    const nearSeed = Math.abs(bodyX-shoulderFrame.x)<=.16 && bodyWidth>=.23 &&
      bodyWidth<=.56 && top<=570 && bottom>=810;
    if (prior && !continuous) { lose('discontinuous subject'); return; }
    if (!prior && !nearSeed) { lose('outside seed shoulder position'); return; }
    const h=(b[2]-b[0])/1000;
    const x=(b[1]+b[3])/2000;
    const scale=(b[3]-b[1])/1000/(upper?shoulderFrame.packWidth:shoulderFrame.width);
    const dt=prior?Math.max(1/24,(number-prior.number)/24):1;
    const vh=prior?.upper===upper?clamp((scale-prior.scale)/dt,-.8,.8):0;
    const vx=prior?clamp((x-prior.x)/dt,-.6,.6):0;
    rangeTrend=Boolean(prior?.upper===upper &&
      scale<prior.scale-.02 && scale<prior.scale*.97 && vh<-.004);
    clearLane=Boolean(placementTarget(scene)) && scene.threat!=='startling' &&
      scene.pose!=='stumbling' && scene.pose!=='startled' &&
      !scene.obstacles?.some(o=>o.relation==='crossing');
    localRatio=null;
    if (continuous) reacquiring = false;
    lost = reacquiring;
    holdReason = reacquiring ? 'confirming returning subject' : null;
    // Body width is more stable across flashlight/arm poses than upper-body width.
    // Hysteresis keeps commands paused until a new reading verifies the restored crop.
    distanceHeld = bodyWidth < shoulderFrame.width * (distanceHeld ? .84 : .78);
    approachClear = Boolean(continuous && scene.rightFloorVisible && scene.pose==='upright' &&
      scene.threat!=='startling' && bodyWidth>=.1 && bodyX>=.1 && bodyX<=.56 &&
      !scene.obstacles?.some(o=>o.relation==='crossing' || validBodyBox(o.box) &&
        o.box[2]>=bottom-20 && o.box[1]<=550 && o.box[3]>=Math.min(450,bodyX*1000+50)));
    lastBox={upper,number,scale,x,bodyX,bodyWidth};
    anchor={x,y:(b[0]*.50+b[2]*.50)/1000,h,scale,top:b[0]/1000,bottom:b[2]/1000,vx,vh,known:true};
    semanticAnchor = { ...anchor, clearLane };
    history[index].track = { ...anchor };
    for (let i = index + 1; i < history.length && anchor.known; i++)
      advance(history[i - 1], history[i]);
    // An ER2 result can arrive two seconds after its pixels. Two consecutive
    // matching readings can authorize one immediate decision even if optical
    // flow could not bridge those earlier frames. Native travel still expires
    // on stale pixels and camera recovery waits for another visual reading.
    semanticThrough = continuous ? Math.min(number+96, history.at(-1).number+8) : -1;
    if (continuous && !anchor.known) reacquiring = false;
  }
  function status() {
    const semantic = semanticThrough>=0 && history.at(-1)?.number<=semanticThrough;
    const opticallyLocated = anchor.known && !lost;
    const usable = opticallyLocated || semantic;
    const measured = !opticallyLocated && semantic ? semanticAnchor : anchor;
    return {
      ...measured,
      known: anchor.known || semantic,
      lost: !usable,
      rangeTrend,
      localRatio,
      clearLane: !opticallyLocated && semantic ? semanticAnchor.clearLane : clearLane,
      distanceHeld,
      bodyWidth:lastBox?.bodyWidth,
      cameraRecovery:Boolean(usable && distanceHeld && approachClear),
      grounded: lastGrounding >= 0,
      observed: lastGrounding,
      holdReason: usable ? distanceHeld ? 'recovering shoulder distance' : null : holdReason,
    };
  }
  function correction(now, allowCamera = true) {
    if (!allowCamera || now < nextCamera) return null;
    const step = cameraStep(status());
    if (!step) return null;
    if (step.reason === 'recover shoulder distance') {
      if (lastRecovery === lastGrounding) return null;
      lastRecovery = lastGrounding;
    }
    const translation = ["key_d", "key_a", "key_w"].includes(step.key);
    if (!translation && lastStaticCorrection === lastGrounding) return null;
    if (!translation) lastStaticCorrection = lastGrounding;
    nextCamera = now + step.ms + (step.key==='key_w' ? 180 : translation ? 300 : 520);
    return { ...step, x: anchor.x, height: anchor.h, velocity: anchor.vx };
  }
  function permits(key) {
    if (mustStopTravel(status())) return false;
    return ["W", "A", "S", "D", "ArrowLeft", "ArrowRight"].includes(key);
  }
  return { push, observe, correction, permits, status };
}

export function characterInstruction(command) {
  const dir = { A: "left", D: "right", ArrowLeft: "left", ArrowRight: "right" }[
    command.key
  ];
  if (command.key === "W")
    return "One continuous trailing shot: the existing foreground robot takes two small walking strides along the visible floor toward the exit. The eye travels the same two strides behind its right shoulder as the floor passes underneath. The head and orange backpack stay large on the left. Robot and viewpoint pause together.";
  if (command.key === "S")
    return "The existing foreground robot takes one small step back along its approach and the observer glides back the same distance behind its right shoulder. Its backpack remains the same size.";
  if (command.key === "A" || command.key === "D")
    return command.reaction === "avoid"
      ? `The robot takes exactly one visible sidestep to its ${dir} around the obstruction, keeping both boots clear. It plants its foot and points its flashlight along the open route.`
      : `The robot takes one small sidestep to its ${dir}, then plants both boots on the floor.`;
  if (dir)
    return `The robot turns its shoulders and flashlight slightly to its ${dir} to inspect the next piece of walkable floor. Its feet stay planted.`;
  return null;
}

export function reactionInstruction(command) {
  if (command.reaction === "startle")
    return "The same small robot jolts at the surprise in front of its boots, makes one short hop back and steadies its flashlight on the obstacle. Both boots land nearby.";
  if (
    command.reaction === "notice" &&
    ["left", "right"].includes(command.toward)
  )
    return `The robot keeps both boots planted and glances to its ${command.toward}, turning just its head and flashlight briefly toward the new movement. Its body stays in place.`;
  return null;
}
