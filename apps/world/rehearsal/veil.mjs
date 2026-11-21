// A live entrance has two independent clocks. House lights and ghosts may move
// while the provider is preparing. Only movement in decoded camera pixels opens it.
const limit = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = (v) => {
  v = limit(v);
  return v * v * (3 - 2 * v);
};
const tau = 2 * Math.PI;

export function createMotionGate() {
  const w = 112,
    h = 64,
    sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
  const g = sample.getContext('2d', { willReadFrequently: true });
  let previous,
    checked = -Infinity,
    first,
    changes;
  return {
    reset() {
      previous = null;
      checked = -Infinity;
      first = 0;
      changes = 0;
    },
    ready(img, body, now) {
      if (!img?.naturalWidth || now - checked < 105) return false;
      checked = now;
      g.drawImage(img, 0, 0, w, h);
      const rgb = g.getImageData(0, 0, w, h).data,
        frame = new Uint8Array(w * h);
      for (let i = 0; i < frame.length; i++)
        frame[i] = (rgb[i * 4] + 2 * rgb[i * 4 + 1] + rgb[i * 4 + 2]) / 4;
      const old = previous;
      previous = frame;
      if (!old) return false;
      const b =
        body?.length === 4
          ? body.map((n) => limit(n / 1000))
          : [0.425, 0.145, 0.835, 0.302];
      if (b[2] <= b[0] || b[3] <= b[1]) return false;
      const midX = (b[1] + b[3]) / 2,
        spanX = b[3] - b[1],
        spanY = b[2] - b[0];
      // Estimate camera translation and a global brightness shift on the room.
      // Neither a new JPEG, a lamp flicker nor a rigid background pan proves a step.
      let best = Infinity,
        dx = 0,
        dy = 0,
        bias = 0;
      for (let sy = -2; sy <= 2; sy++)
        for (let sx = -2; sx <= 2; sx++) {
          let sum = 0,
            n = 0;
          for (let y = 5; y < h - 5; y += 6)
            for (let x = 5; x < w - 5; x += 7) {
              if (
                x / w > b[1] - 0.03 &&
                x / w < b[3] + 0.03 &&
                y / h > b[0] - 0.04 &&
                y / h < b[2] + 0.04
              )
                continue;
              sum += frame[y * w + x] - old[(y + sy) * w + x + sx];
              n++;
            }
          const shift = sum / n;
          let error = 0;
          for (let y = 5; y < h - 5; y += 6)
            for (let x = 5; x < w - 5; x += 7) {
              if (
                x / w > b[1] - 0.03 &&
                x / w < b[3] + 0.03 &&
                y / h > b[0] - 0.04 &&
                y / h < b[2] + 0.04
              )
                continue;
              error += Math.abs(
                frame[y * w + x] - old[(y + sy) * w + x + sx] - shift,
              );
            }
          error = error / n + 0.15 * (Math.abs(sx) + Math.abs(sy));
          if (error < best) {
            best = error;
            dx = sx;
            dy = sy;
            bias = shift;
          }
        }
      let leg = 0,
        legTotal = 0,
        bodyChange = 0,
        total = 0;
      const x0 = limit(Math.floor((midX - 0.42 * spanX) * w), 3, w - 4),
        x1 = limit(Math.ceil((midX + 0.42 * spanX) * w), 3, w - 4);
      const y0 = limit(Math.floor((b[0] + 0.18 * spanY) * h), 3, h - 4),
        y1 = limit(Math.ceil(b[2] * h), 3, h - 4);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const difference = Math.abs(
            frame[y * w + x] - old[(y + dy) * w + x + dx] - bias,
          );
          const changed = difference > Math.max(11, best * 1.35);
          if (changed) bodyChange++;
          total++;
          if (y > y0 + (y1 - y0) * 0.59) {
            legTotal++;
            if (changed) leg++;
          }
        }
      if (bodyChange / total > 0.075 && leg / legTotal > 0.065) {
        if (!first || now - first > 1100) {
          first = now;
          changes = 0;
        }
        changes++;
      } else if (now - first > 550) {
        first = 0;
        changes = 0;
      }
      return changes >= 3 && now - first >= 205;
    },
  };
}

function clothTexture() {
  const tile = document.createElement('canvas');
  tile.width = 480;
  tile.height = 270;
  const g = tile.getContext('2d'),
    pixels = g.createImageData(tile.width, tile.height);
  const n = 96,
    noise = new Float32Array(n * n);
  let seed = 63847;
  for (let i = 0; i < noise.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noise[i] = seed / 4294967296;
  }
  const value = (x, y) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      a = ease(x - i),
      b = ease(y - j);
    const at = (u, v) => noise[(((v % n) + n) % n) * n + (((u % n) + n) % n)];
    return (
      (1 - b) * (at(i, j) * (1 - a) + at(i + 1, j) * a) +
      b * (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a)
    );
  };
  for (let y = 0; y < tile.height; y++)
    for (let x = 0; x < tile.width; x++) {
      const u = x / tile.width,
        v = y / tile.height;
      const warp = value(6 * u, 5 * v);
      const clouds =
        0.52 * value(u * 5 + 2 * warp, v * 5) +
        0.3 * value(u * 11, v * 8 + warp) +
        0.18 * value(u * 27, v * 17);
      const folds = Math.pow(
        0.5 + 0.5 * Math.sin(17 * v + 8 * u + 8 * clouds),
        3,
      );
      const light = limit(1 - Math.hypot((u - 0.54) * 1.4, (v - 0.47) * 1.3));
      const k = (y * tile.width + x) * 4,
        bloom = light * light * (8 + 20 * clouds) + 8 * folds * clouds;
      pixels.data[k] = 8 + 0.66 * bloom;
      pixels.data[k + 1] = 15 + 1.2 * bloom;
      pixels.data[k + 2] = 20 + 1.19 * bloom;
      pixels.data[k + 3] = 255;
    }
  g.putImageData(pixels, 0, 0);
  return tile;
}

// A small illuminated hood and a long, wind-caught hem give the ghost a silhouette
// while the larger shroud can occlude the entire projector.
function apparition(g, x, y, scale, t) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.rotate(-0.09 + Math.sin(t * 0.37) * 0.025);
  const wind = Math.sin(t * 0.63) * 8;
  const glow = g.createRadialGradient(8, -2, 10, 4, 0, 168);
  glow.addColorStop(0, '#a4d7bd3b');
  glow.addColorStop(0.48, '#9cd3bc16');
  glow.addColorStop(1, '#8fc6bd00');
  g.fillStyle = glow;
  g.fillRect(-180, -175, 360, 350);
  g.beginPath();
  g.moveTo(-35, 6);
  g.bezierCurveTo(-39, -32, -23, -69, 6, -75);
  g.bezierCurveTo(34, -84, 58, -58, 56, -32);
  g.bezierCurveTo(54, -11, 49, 5, 65, 23);
  g.bezierCurveTo(72, 34, 91, 38, 104, 34);
  g.bezierCurveTo(95, 49, 72, 52, 62, 46);
  g.bezierCurveTo(43, 36, 44, 54, 55, 67);
  g.bezierCurveTo(36, 63, 28, 51, 17, 48);
  g.bezierCurveTo(-3, 47, -9, 74 + wind, -47, 85 + wind);
  g.bezierCurveTo(-37, 66, -23, 48, -37, 59);
  g.bezierCurveTo(-62, 84, -88, 88 + wind, -121, 72 + wind);
  g.bezierCurveTo(-75, 71, -52, 45, -42, 25);
  g.quadraticCurveTo(-36, 13, -35, 6);
  g.closePath();
  const fabric = g.createLinearGradient(-79, 73, 46, -76);
  fabric.addColorStop(0, '#72948b18');
  fabric.addColorStop(0.27, '#7fa79b94');
  fabric.addColorStop(0.58, '#aecabb');
  fabric.addColorStop(0.84, '#d8e0cb');
  fabric.addColorStop(1, '#fff3d6');
  g.fillStyle = fabric;
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 11; i++) {
    g.beginPath();
    g.moveTo(-40 + i * 11, -64 + i);
    g.bezierCurveTo(
      -13 + i * 9,
      -15,
      -5 + i * 7,
      25,
      -120 + i * 17,
      107 + wind,
    );
    g.lineWidth = i % 3 === 0 ? 6 : 2;
    g.strokeStyle = i % 2 ? '#f3e8c533' : '#41665d26';
    g.stroke();
  }
  g.restore();
  // Two ink-dark folds under the hood stay readable at projector distance.
  for (const [ex, ey, rx, ry] of [
    [15, -31, 5.5, 8],
    [39, -32, 4.8, 7.5],
  ]) {
    g.beginPath();
    g.ellipse(ex, ey, rx, ry, 0.13, 0, tau);
    g.fillStyle = '#284741';
    g.fill();
  }
  g.restore();
}
export function createGhostVeil(width, height) {
  const texture = clothTexture();
  const edge = (v, t) =>
    0.047 * Math.sin(v * 5 + t * 0.75) +
    0.026 * Math.sin(v * 13 - t * 0.8) +
    0.019 * Math.sin(v * 27 + t * 0.9);
  function boundary(g, front, t) {
    for (let j = 0; j <= 68; j++) {
      const v = j / 68,
        x = width * (front + edge(v, t)),
        y = v * height;
      if (!j) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  return function renderVeil(g, phase, progress, time, reduced) {
    if (
      (progress <= 0 && phase === 'cover') ||
      (progress >= 1 && phase === 'reveal')
    )
      return;
    const t = reduced ? 0 : time / 1000;
    const full = phase === 'hold' || (phase === 'cover' && progress >= 1);
    const front = -0.13 + 1.26 * ease(progress);
    g.save();
    if (!full) {
      if (reduced) g.globalAlpha = phase === 'cover' ? progress : 1 - progress;
      else {
        g.beginPath();
        boundary(g, front, t);
        const side = phase === 'cover' ? 0 : width;
        g.lineTo(side, height);
        g.lineTo(side, 0);
        g.closePath();
        g.clip();
      }
    }
    // This base is always opaque during the hold, including the borders.
    g.fillStyle = '#0c1619';
    g.fillRect(0, 0, width, height);
    const sway = reduced ? 0 : Math.sin(t * 0.16);
    g.drawImage(
      texture,
      -width * (0.035 + 0.015 * sway),
      -height * 0.045,
      width * 1.09,
      height * 1.09,
    );
    const cx = width * (0.51 + 0.022 * sway),
      cy = height * (0.47 + 0.012 * Math.sin(t * 0.54));
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const y = height * (0.35 + i * 0.041),
        lift = height * 0.12 * Math.sin(t * 0.24 + i * 0.5);
      g.beginPath();
      g.moveTo(-0.15 * width, y + lift);
      g.bezierCurveTo(
        0.2 * width,
        y + 0.24 * height,
        0.26 * width,
        cy + 0.2 * height + lift,
        0.52 * width,
        cy + 0.03 * height,
      );
      g.bezierCurveTo(
        0.69 * width,
        cy - 0.19 * height,
        0.82 * width,
        y - 0.08 * height,
        1.09 * width,
        y - 0.12 * height + lift,
      );
      g.strokeStyle = i % 3 ? '#b4dbca0c' : '#a9ccbf10';
      g.lineWidth = i % 3 ? 1.4 : 4;
      g.stroke();
    }
    const position = full
      ? 0.53
      : phase === 'cover'
        ? -0.1 + 0.63 * ease(progress)
        : 0.53 + 0.68 * ease(progress);
    apparition(
      g,
      reduced ? cx : width * position + width * 0.012 * sway,
      cy,
      height / 660,
      t,
    );
    g.restore();
    if (!full && !reduced) {
      g.save();
      g.beginPath();
      boundary(g, front, t);
      g.strokeStyle = '#8cbaa92b';
      g.lineWidth = width * 0.014;
      g.stroke();
      g.strokeStyle = '#b7d0b469';
      g.lineWidth = width * 0.0026;
      g.stroke();
      g.restore();
    }
  };
}


// Measure the outgoing shot once. Black alpha over its lit surfaces lets the
// practical lamps and their pool on the floor falter before the room loses power.
export function practicalLightMask(frame) {
  const mask=document.createElement('canvas');
  mask.width=120;mask.height=68;
  const g=mask.getContext('2d',{willReadFrequently:true});
  g.drawImage(frame,0,0,mask.width,mask.height);
  const sample=g.getImageData(0,0,mask.width,mask.height);
  for (let y=0;y<mask.height;y++) for (let x=0;x<mask.width;x++) {
    const i=(y*mask.width+x)*4, data=sample.data;
    const r=data[i],green=data[i+1],b=data[i+2];
    const brightness=.2126*r+.7152*green+.0722*b;
    const u=x/(mask.width-1),v=y/(mask.height-1);
    const lane=Math.exp(-.5*(((u-.64)/.29)**2+((v-.52)/.54)**2));
    // Bright practical bulbs can be nearly white; warmly lit floor is darker.
    const glow=limit((brightness-42)/130);
    const warmth=limit((r-b+5)/56);
    data[i]=2;data[i+1]=4;data[i+2]=6;
    data[i+3]=255*lane*glow*(.55+.45*Math.max(warmth,glow));
  }
  g.putImageData(sample,0,0);
  return mask;
}

// Only the hallway loses power. The projector's DOM remains legible above the canvas.
export function hallwayBlackout(ctx, width, height, progress, phase, still, practicalLights) {
  const p=limit(progress);
  if (p===0) return;
  ctx.save();
  if (p===1) {
    ctx.fillStyle='#020405';ctx.fillRect(0,0,width,height);
    ctx.restore();return;
  }
  let dark=ease(p);
  if (!still && phase==='close') {
    // One short drop, a partial recovery, then complete loss of power.
    const sag=.94*ease((p-.045)/.12)*(1-ease((p-.24)/.17));
    if (practicalLights && sag>0) {
      ctx.globalAlpha=sag;
      ctx.drawImage(practicalLights,0,0,width,height);
    }
    dark=.08*ease(p/.42)+.92*ease((p-.43)/.57);
  }
  ctx.globalAlpha=dark;ctx.fillStyle='#020405';ctx.fillRect(0,0,width,height);
  if (!still && phase==='open') {
    ctx.globalAlpha=.12*Math.sin(Math.PI*p);
    const warmth=ctx.createRadialGradient(width*.63,height*.36,0,width*.63,height*.36,width*.58);
    warmth.addColorStop(0,'#d8a961');warmth.addColorStop(1,'#ab814300');
    ctx.fillStyle=warmth;ctx.fillRect(0,0,width,height);
  }
  ctx.restore();
}
