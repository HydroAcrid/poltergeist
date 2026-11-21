const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};
const image = async (src) => {
  const i = new Image();
  i.src = src;
  await i.decode();
  return i;
};

export async function createScene(canvas) {
  const ctx = canvas.getContext('2d'),
    W = 1280,
    H = 720;
  const [hall, robot, peel] = await Promise.all(
    ['/hall.webp', '/explorer.webp', '/peel.webp'].map(image),
  );
  let source = await image('/rehearsal/source'),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function cover(i, zoom = 1, cx = 0.5, cy = 0.5) {
    const scale = Math.max(W / i.width, H / i.height) * zoom,
      w = i.width * scale,
      h = i.height * scale;
    ctx.drawImage(i, -(w - W) * cx, -(h - H) * cy, w, h);
  }
  function room(custom, amount = 1) {
    ctx.save();
    ctx.globalAlpha = amount;
    if (custom) {
      ctx.filter = 'brightness(.68) saturate(.69) contrast(1.10)';
      cover(source, 1.1, 0.4, 0.68);
      ctx.filter = 'none';
      const tint = ctx.createLinearGradient(0, 0, W, H);
      tint.addColorStop(0, '#263d402b');
      tint.addColorStop(1, '#f9bf6020');
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
    } else cover(hall);
    ctx.restore();
  }
  function floor(d, l, custom) {
    return {
      x: (0.235 + (custom ? 0.36 : 0.537) * d + l * (0.115 - 0.075 * d)) * W,
      y: (0.93 - (custom ? 0.345 : 0.43) * d) * H,
    };
  }
  function adventurer(
    d,
    l,
    custom,
    opacity = 1,
    walk = 0,
    flinch = 0,
    entry = 0,
  ) {
    const p = floor(d, l, custom),
      h = H * 0.34 * (1 - 0.68 * d),
      w = (h * robot.width) / robot.height;
    p.x -= entry * 0.065 * W;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(p.x, p.y);
    ctx.fillStyle = '#15140d58';
    ctx.beginPath();
    ctx.ellipse(0, -2, w * 0.32, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(flinch * -0.11);
    const ax = w * 0.33,
      ay = -h * 0.67;
    const glow = ctx.createRadialGradient(
      ax,
      ay,
      0,
      ax + h * 0.55,
      ay - h * 0.06,
      h * 0.8,
    );
    glow.addColorStop(0, 'rgba(255,206,120,.51)');
    glow.addColorStop(1, 'rgba(255,198,110,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + h * 1.2, ay - h * 0.3);
    ctx.lineTo(ax + h * 1.2, ay + h * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.drawImage(robot, -w / 2, -h + walk * h * 0.009, w, h);
    ctx.restore();
  }
  function prop(item, custom, now) {
    const p = floor(item.depth, item.lane, custom),
      s = 1 - item.depth * 0.61,
      age = now - item.placedAt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(age / 320);
    if (item.kind === 'peel') ctx.drawImage(peel, -51, -40, 102, 40);
    else if (item.kind === 'lights') {
      if (age < 4300) {
        ctx.resetTransform();
        ctx.fillStyle = '#151b2e68';
        ctx.fillRect(0, 0, W, H);
      }
    } else if (item.kind === 'fog') {
      const g = ctx.createRadialGradient(0, -22, 2, 0, -20, 170);
      g.addColorStop(0, '#dae9d3bb');
      g.addColorStop(1, '#d5e2cf00');
      ctx.fillStyle = g;
      ctx.fillRect(-170, -190, 340, 340);
    } else if (item.kind === 'papers') {
      ctx.fillStyle = '#eee4c6';
      for (let i = 0; i < 7; i++) {
        ctx.save();
        ctx.translate(-87 + i * 25, -18 - (i % 3) * 24);
        ctx.rotate(i * 0.68);
        ctx.fillRect(-13, -8, 26, 16);
        ctx.restore();
      }
    } else if (item.kind === 'chair') {
      ctx.fillStyle = '#e5ae5e';
      ctx.strokeStyle = '#49301a';
      ctx.lineWidth = 3;
      ctx.rotate(-0.19);
      for (const a of [
        [-24, -63, 10, 62],
        [20, -64, 10, 64],
        [-24, -67, 54, 13],
        [-23, -105, 10, 47],
        [20, -105, 9, 47],
        [-24, -105, 54, 18],
      ]) {
        ctx.fillRect(...a);
        ctx.strokeRect(...a);
      }
    } else if (item.kind === 'marbles' || item.kind === 'balloons') {
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.fillStyle = ['#b5d8ca', '#ffbf91', '#d1abe5'][i % 3];
        ctx.arc(
          -30 + i * 14,
          -8 - (i % 2) * 8 - (item.kind === 'balloons' ? 45 : 0),
          item.kind === 'balloons' ? 19 : 6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (item.kind === 'bucket') {
      ctx.fillStyle = '#96bec2';
      ctx.fillRect(-20, -40, 40, 37);
      ctx.strokeStyle = '#d4edea';
      ctx.strokeRect(-20, -42, 40, 5);
    } else {
      ctx.fillStyle = '#425b53';
      ctx.fillRect(-20, -85, 40, 84);
      ctx.fillStyle = '#fff7c9';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('EXIT', -13, -65);
    }
    ctx.restore();
  }
  function paint(state, now, forceGame = false) {
    const r = state.round,
      custom = state.custom;
    const elapsed = r ? (now - r.openedAt) / 1000 : 0,
      show = r?.phase === 'opening' ? smooth((elapsed - 2) / 6) : r ? 1 : 0;
    if (!forceGame && show < 1) {
      ctx.fillStyle = '#121611';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      const scale = Math.min(W / source.width, H / source.height),
        w = source.width * scale,
        h = source.height * scale;
      ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
    }
    const blend = forceGame ? 1 : reduced.matches ? Number(show >= 0.5) : show;
    if (blend) room(custom, blend);
    if (
      !forceGame &&
      r?.phase === 'opening' &&
      show > 0 &&
      show < 1 &&
      !reduced.matches
    ) {
      const x = show * (W + 220) - 110,
        g = ctx.createLinearGradient(x - 100, 0, x + 100, 0);
      g.addColorStop(0, 'transparent');
      g.addColorStop(0.5, '#efdfb334');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(x - 100, 0, 200, H);
    }
    const entry = forceGame
      ? 1
      : r?.phase === 'opening'
        ? smooth((elapsed - 8) / 2.8)
        : r
          ? 1
          : 0;
    if (!entry) return;
    const props = r?.live ? [] : r?.props || [];
    for (const item of props.filter((i) => i.depth >= (r?.depth || 0)))
      prop(item, custom, now);
    const since = now - (r?.lastReaction?.at || 0);
    const flinch =
      !reduced.matches && r?.lastReaction?.flinch && since < 1050
        ? Math.sin((Math.PI * since) / 1050)
        : 0;
    adventurer(
      r?.depth || 0,
      r?.lane || 0,
      custom,
      entry,
      r?.phase === 'playing' && !reduced.matches ? Math.sin(now / 145) : 0,
      flinch,
      reduced.matches ? 0 : 1 - entry,
    );
    for (const item of props.filter((i) => i.depth < (r?.depth || 0)))
      prop(item, custom, now);
  }
  return {
    paint,
    async setPhoto(rev) {
      source = await image('/rehearsal/source?v=' + rev);
    },
    seed(state) {
      paint({ ...state, round: null }, Date.now(), true);
      const small = document.createElement('canvas');
      small.width = 960;
      small.height = 540;
      small.getContext('2d').drawImage(canvas, 0, 0, 960, 540);
      for (const quality of [0.68, 0.55, 0.42, 0.3, 0.2]) {
        const encoded = small.toDataURL('image/jpeg', quality).split(',')[1];
        if (encoded.length <= 64000) return encoded;
      }
      throw Error('The camera image is too large to open.');
    },
  };
}
