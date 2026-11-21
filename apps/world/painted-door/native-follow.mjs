// Measure displacement in native frames. All corrections go to Genie's camera controls.
import jpeg from "jpeg-js";

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
  return {
    x: bx / width,
    y: by / height,
    h: anchor.h,
    known: anchor.known && best < 48,
  };
}

export function nativePan(x, known, previousSide = 0) {
  if (!known)
    return previousSide < 0
      ? "arrow_left"
      : previousSide > 0
        ? "arrow_right"
        : null;
  if (x < 0.18) return "arrow_left";
  if (x > 0.53) return "arrow_right";
  return null;
}
export function createNativeFollow() {
  const history = [];
  let anchor = { x: 0.22, y: 0.65, h: 0.38, known: true },
    lastGrounding = 0,
    side = 0,
    nextPan = 0;
  let lost = false,
    safeToClose = false,
    rangeDirection = 0,
    tiltKey = null;
  function push(bytes, number) {
    const f = sampleFrame(bytes, number),
      prev = history.at(-1);
    if (prev) anchor = locate(prev, f, anchor);
    history.push(f);
    if (history.length > 30) history.shift();
  }
  function observe(scene, number) {
    if (number <= lastGrounding) return;
    lastGrounding = number;
    tiltKey = null;
    rangeDirection = 0;
    if (!scene.visible) {
      lost = true;
      anchor.known = false;
      return;
    }
    const p = history.findIndex((f) => f.number >= number);
    if (p < 0 || number < history[0].number) return;
    const footX = (scene.feet.left[1] + scene.feet.right[1]) / 2000,
      footY = (scene.feet.left[0] + scene.feet.right[0]) / 2000;
    const box = scene.bodyBox;
    anchor = box
      ? {
          x: (box[1] + box[3]) / 2000,
          y: (box[0] * 0.45 + box[2] * 0.55) / 1000,
          h: (box[2] - box[0]) / 1000,
          known: true,
        }
      : {
          x: footX,
          y: clamp(footY - anchor.h * 0.48, 0.08, 0.95),
          h: anchor.h,
          known: true,
        };
    lost = false;
    if (box && box[0] > 85 && box[2] > 935) tiltKey = "arrow_down";
    if (box && box[0] < 65 && box[2] < 900) tiltKey = "arrow_up";
    safeToClose =
      scene.pose === "upright" &&
      scene.threat === "ordinary" &&
      scene.obstacles.length === 0;
    rangeDirection = box
      ? anchor.h < 0.22
        ? 1
        : anchor.h > 0.61 && footY > 0.9
          ? -1
          : 0
      : 0;
    for (let i = p + 1; i < history.length; i++)
      anchor = locate(history[i - 1], history[i], anchor);
  }
  function correction(now, allowTravel = true) {
    if (anchor.known) side = anchor.x < 0.18 ? -1 : anchor.x > 0.53 ? 1 : 0;
    const key = nativePan(anchor.x, anchor.known, side);
    if (now < nextPan) return null;
    if (!key) {
      if (tiltKey && anchor.known && !lost) {
        const key = tiltKey;
        tiltKey = null;
        nextPan = now + 680;
        return { key, ms: 140, x: anchor.x };
      }
      if (
        !allowTravel ||
        !anchor.known ||
        lost ||
        !safeToClose ||
        !rangeDirection
      )
        return null;
      nextPan = now + 1000;
      const rangeKey = rangeDirection > 0 ? "key_w" : "key_s";
      rangeDirection = 0; // A subsequent independent body measurement must authorize another move.
      return {
        key: rangeKey,
        ms: rangeKey === "key_w" ? 330 : 180,
        x: anchor.x,
      };
    }
    // Wait for the actual steering response before making a second correction.
    nextPan = now + 680;
    const error = Math.abs(anchor.x - 0.34);
    return {
      key,
      ms: clamp(Math.round(120 + error * 330), 120, 300),
      x: anchor.x,
    };
  }
  function permits(key) {
    if (lost || !anchor.known) return false;
    if (key === "ArrowLeft") return anchor.x < 0.49;
    if (key === "ArrowRight") return anchor.x > 0.23;
    return anchor.x > 0.08 && anchor.x < 0.89;
  }
  return {
    push,
    observe,
    correction,
    permits,
    status: () => ({ ...anchor, lost }),
  };
}
