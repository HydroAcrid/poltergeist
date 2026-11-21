const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const drop = document.querySelector('#drop');
const reset = document.querySelector('#reset');
const audience = document.querySelector('#audience');
const player = document.querySelector('#robot');
const walk = document.querySelector('#walk');
const left = document.querySelector('#left');
const right = document.querySelector('#right');
const statusText = document.querySelector('#status');
const middle = { lane: 0, depth: 0.34 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let ghost,
  peel,
  hallway,
  hazard,
  request,
  audienceView = true,
  lastFrame = 0;
let actor = initialActor();

function initialActor() {
  return {
    lane: 0,
    targetLane: 0,
    depth: 0,
    distance: 0,
    moving: false,
    slipStart: null,
  };
}
function project(lane, depth) {
  const width = 0.212 - 0.18 * depth;
  return { x: 0.58 - 0.115 * depth + lane * width, y: 0.95 - 0.41 * depth };
}
function floorPoint(x, y) {
  const depth = (0.95 - y) / 0.41;
  const lane = (x - (0.58 - 0.115 * depth)) / (0.212 - 0.18 * depth);
  return depth >= 0 && depth <= 1 && Math.abs(lane) <= 1
    ? { lane, depth }
    : null;
}
function load(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}
function footprint(now) {
  const age = (now - hazard.start) / 1000;
  if (age < 0.4) return;
  const point = project(hazard.lane, hazard.depth);
  const x = point.x * 1280,
    y = point.y * 720,
    size = 140 - 90 * hazard.depth;
  const fall = reducedMotion.matches ? 0 : Math.max(0, 1 - (age - 0.4) / 0.29);
  ctx.save();
  ctx.fillStyle = 'rgba(46,30,14,.30)';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(x, y - 2, size * 0.45, size * 0.055, -0.08, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  const h = ((size * peel.height) / peel.width) * (hazard.spent ? 0.65 : 1);
  ctx.drawImage(peel, x - size / 2, y - h - fall * fall * 28, size, h);
}
function signature(now) {
  const age = (now - hazard.start) / 1000;
  if (!audienceView || age < 0 || age >= 1.7) return;
  const point = project(hazard.lane, hazard.depth);
  const size = 140 - 90 * hazard.depth;
  const show = reducedMotion.matches
    ? 1
    : Math.min(1, age / 0.16, (1.7 - age) / 0.4);
  const w = size * 1.08 * (0.82 + 0.18 * show),
    h = (w * ghost.height) / ghost.width;
  ctx.save();
  ctx.globalAlpha = show * 0.92;
  ctx.translate(
    point.x * 1280 - size * 0.4,
    point.y * 720 -
      size * 0.38 -
      (reducedMotion.matches ? 0 : Math.sin((age / 1.7) * Math.PI) * 12),
  );
  ctx.rotate(-0.07 + 0.11 * Math.min(1, age / 0.55));
  ctx.drawImage(ghost, -w, -h, w, h);
  ctx.restore();
}
function advance(dt, now) {
  if (actor.slipStart !== null) {
    if (now - actor.slipStart < 1250) return;
    actor.slipStart = null;
    statusText.textContent = 'Back on its feet.';
  }
  const step =
    Math.sign(actor.targetLane - actor.lane) *
    Math.min(Math.abs(actor.targetLane - actor.lane), dt * 1.65);
  actor.lane += step;
  const forward = actor.moving ? Math.min(1 - actor.depth, dt * 0.17) : 0;
  actor.depth += forward;
  actor.distance += Math.abs(step) * 0.48 + forward * 3.9;
  if (
    hazard &&
    !hazard.spent &&
    now - hazard.start >= 690 &&
    Math.hypot(
      (actor.lane - hazard.lane) / 0.215,
      (actor.depth - hazard.depth) / 0.052,
    ) <= 1
  ) {
    hazard.spent = true;
    actor.slipStart = now;
    actor.moving = false;
    actor.targetLane = actor.lane;
    statusText.textContent = 'Slipped on the peel.';
  } else if (actor.moving && actor.depth >= 1) {
    actor.moving = false;
    statusText.textContent = 'Reached the end of the test aisle.';
  }
}
function paint(now) {
  cancelAnimationFrame(request);
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.04));
  lastFrame = now;
  advance(dt, now);
  ctx.drawImage(hallway, 0, 0, 1280, 720);
  const point = project(actor.lane, actor.depth);
  const motion =
    actor.moving || Math.abs(actor.targetLane - actor.lane) > 0.001;
  const stumble =
    actor.slipStart === null
      ? 0
      : Math.sin(Math.PI * Math.min(1, (now - actor.slipStart) / 1250)) ** 0.7;
  const avatar = () =>
    drawRobot(
      ctx,
      point,
      actor.depth,
      motion && !reducedMotion.matches ? Math.sin(actor.distance * 23) : 0,
      reducedMotion.matches ? (stumble > 0 ? 0.2 : 0) : stumble,
    );
  if (hazard && actor.depth > hazard.depth) {
    avatar();
    footprint(now);
  } else {
    if (hazard) footprint(now);
    avatar();
  }
  if (hazard) signature(now);
  if (
    motion ||
    actor.slipStart !== null ||
    (hazard && now - hazard.start < 1720)
  )
    request = requestAnimationFrame(paint);
}
function trigger(point) {
  if (!hallway) return;
  hazard = { ...point, start: performance.now(), spent: false };
  reset.disabled = false;
  statusText.textContent = 'Haunting triggered.';
  paint(hazard.start);
}
function steer(direction) {
  if (!hallway || actor.slipStart !== null || actor.depth >= 1) return;
  if (direction === 0) {
    actor.moving = true;
    statusText.textContent = 'Walking up the aisle.';
  } else {
    actor.targetLane = Math.max(
      -1,
      Math.min(1, actor.targetLane + direction * 0.52),
    );
    statusText.textContent = 'Stepping ' + (direction < 0 ? 'left.' : 'right.');
  }
  reset.disabled = false;
  paint(performance.now());
}
function view(isAudience) {
  audienceView = isAudience;
  audience.setAttribute('aria-pressed', String(isAudience));
  player.setAttribute('aria-pressed', String(!isAudience));
  if (hallway) paint(performance.now());
}
canvas.addEventListener('click', (event) => {
  if (!hallway) return;
  const r = canvas.getBoundingClientRect();
  const point = floorPoint(
    (event.clientX - r.left) / r.width,
    (event.clientY - r.top) / r.height,
  );
  if (point) trigger(point);
  else statusText.textContent = 'Choose a spot on the open wood aisle.';
});
drop.onclick = () => trigger(middle);
walk.onclick = () => steer(0);
left.onclick = () => steer(-1);
right.onclick = () => steer(1);
reset.onclick = () => {
  actor = initialActor();
  hazard = null;
  reset.disabled = true;
  statusText.textContent = 'Hallway clear.';
  paint(performance.now());
};
document.addEventListener('keydown', (event) => {
  const keys = {
    KeyW: 0,
    ArrowUp: 0,
    KeyA: -1,
    ArrowLeft: -1,
    KeyD: 1,
    ArrowRight: 1,
  };
  if (
    !Object.hasOwn(keys, event.code) ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  if (!event.repeat) steer(keys[event.code]);
});
audience.onclick = () => view(true);
player.onclick = () => view(false);
Promise.all([load('ghost.webp'), load('peel.webp'), load('aisle.jpg')])
  .then((images) => {
    [ghost, peel, hallway] = images;
    for (const b of [drop, walk, left, right]) b.disabled = false;
    statusText.textContent = 'Hallway clear.';
    paint(performance.now());
  })
  .catch(
    () =>
      (statusText.textContent = 'The hallway photo or artwork could not load.'),
  );
