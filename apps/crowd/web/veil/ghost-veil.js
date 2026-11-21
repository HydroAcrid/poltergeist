// Full-screen ghost veil for the audience opening (art direction: Crowd; timing: World).
//
//   import { createGhostVeil } from "/veil/ghost-veil.js";
//   const veil = createGhostVeil(document.body, { zIndex: 5 });  // under World's HUD
//   await veil.cover();   // when the opening starts: an apparition sweeps over the lens
//   ...                   // holds full coverage and keeps "breathing" while Genie prepares
//   await veil.part();    // only once the live feed itself has motion
//
// part() before cover() finishes waits for full coverage, so the scene is never exposed
// mid-sweep. prefers-reduced-motion: a still, opaque veil with short fades. No dependencies.
import { createVeilMachine } from "./veil-machine.js";

const CSS = `
.pg-veil{position:fixed;inset:0;pointer-events:none;overflow:hidden;contain:strict}
.pg-veil[data-state=idle],.pg-veil[data-state=gone]{visibility:hidden}
.pg-veil__sheet{position:absolute;inset:-12%;background:
  radial-gradient(60% 45% at 30% 35%,rgba(255,246,232,.10),transparent 70%),
  radial-gradient(55% 50% at 72% 62%,rgba(255,192,141,.08),transparent 70%),
  radial-gradient(90% 80% at 50% 50%,#1d1916 0%,#110f0d 55%,#0a0908 100%);
  filter:url(#pg-veil-mist)}
.pg-veil__wisps{position:absolute;inset:-20%;opacity:.55;mix-blend-mode:screen;background:
  radial-gradient(22% 14% at 20% 30%,rgba(255,246,232,.22),transparent 70%),
  radial-gradient(18% 12% at 70% 22%,rgba(255,246,232,.16),transparent 70%),
  radial-gradient(26% 16% at 55% 75%,rgba(255,246,232,.18),transparent 70%),
  radial-gradient(16% 10% at 85% 60%,rgba(255,192,141,.14),transparent 70%);
  filter:url(#pg-veil-mist)}
.pg-veil__half{position:absolute;top:0;bottom:0;width:58%;overflow:hidden}
.pg-veil__half--l{left:0}
.pg-veil[data-state=parting] .pg-veil__half--l{-webkit-mask-image:linear-gradient(to left,transparent 0,#000 14%);mask-image:linear-gradient(to left,transparent 0,#000 14%)}
.pg-veil__half--r{right:0;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 14%);mask-image:linear-gradient(to right,transparent 0,#000 14%)}
/* Both halves draw the same full-screen mist at the same screen position, so the overlap has no seam. */
.pg-veil__half .pg-veil__sheet,.pg-veil__half .pg-veil__wisps{width:124vw;height:124vh;top:-12vh;bottom:auto}
.pg-veil__half--l .pg-veil__sheet,.pg-veil__half--l .pg-veil__wisps{left:-12vw;right:auto}
.pg-veil__half--r .pg-veil__sheet,.pg-veil__half--r .pg-veil__wisps{right:-12vw;left:auto}
.pg-veil__halves{position:absolute;inset:0;clip-path:circle(0% at -8% 62%)}
.pg-veil__ghost{position:absolute;left:0;top:50%;width:38vmin;height:46vmin;margin-top:-23vmin;opacity:0;filter:drop-shadow(0 0 3vmin rgba(255,246,232,.55)) blur(.2vmin)}
.pg-veil__ghost svg{width:100%;height:100%}
/* sweep in: the apparition crosses the lens and the veil spreads behind it */
.pg-veil[data-state=sweeping] .pg-veil__halves{animation:pg-veil-spread 1.9s cubic-bezier(.55,.05,.35,1) forwards}
.pg-veil[data-state=sweeping] .pg-veil__ghost{animation:pg-veil-pass 1.9s cubic-bezier(.45,0,.3,1) forwards}
@keyframes pg-veil-spread{0%{clip-path:circle(0% at -8% 62%)}100%{clip-path:circle(160% at 55% 50%)}}
@keyframes pg-veil-pass{0%{transform:translateX(-45vmin) scale(.55) rotate(-6deg);opacity:0}
  20%{opacity:.95}70%{opacity:.9}100%{transform:translateX(118vw) scale(1.7) rotate(4deg);opacity:0}}
/* hold: fully covered, breathing; a faint ghost drifts so a slow start still feels alive */
.pg-veil[data-state=holding] .pg-veil__ghost{left:50%;margin-left:-19vmin;opacity:.13;animation:pg-veil-float 6s ease-in-out infinite}
@keyframes pg-veil-float{0%,100%{transform:translate(-3vmin,1.5vmin) scale(1.05)}50%{transform:translate(3vmin,-1.5vmin) scale(1.12)}}
.pg-veil[data-state=parting] .pg-veil__ghost{left:50%;margin-left:-19vmin;animation:pg-veil-fade-out .6s ease-out forwards;opacity:.13}
.pg-veil--still[data-state=holding] .pg-veil__ghost{display:none}
.pg-veil[data-state=holding] .pg-veil__halves,.pg-veil[data-state=parting] .pg-veil__halves{clip-path:none}
.pg-veil[data-state=holding] .pg-veil__sheet{animation:pg-veil-breathe 5.5s ease-in-out infinite}
.pg-veil[data-state=holding] .pg-veil__wisps{animation:pg-veil-drift 11s ease-in-out infinite alternate}
@keyframes pg-veil-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.035);opacity:.96}}
@keyframes pg-veil-drift{0%{transform:translate(-2%,1%) scale(1)}100%{transform:translate(3%,-2%) scale(1.08)}}
.pg-veil__halves::after{content:"";position:absolute;inset:0;background:#0a0908;opacity:.0}
.pg-veil[data-state=holding] .pg-veil__halves::after{opacity:.0}
/* part: the veil opens from the middle like a curtain and thins away */
.pg-veil[data-state=parting] .pg-veil__half--l{animation:pg-veil-open-l 1.5s cubic-bezier(.6,0,.3,1) forwards}
.pg-veil[data-state=parting] .pg-veil__half--r{animation:pg-veil-open-r 1.5s cubic-bezier(.6,0,.3,1) forwards}
@keyframes pg-veil-open-l{0%{transform:translateX(0);opacity:1}70%{opacity:.85}100%{transform:translateX(-62%);opacity:0}}
@keyframes pg-veil-open-r{0%{transform:translateX(0);opacity:1}70%{opacity:.85}100%{transform:translateX(62%);opacity:0}}
/* reduced motion: still, opaque, short fades */
.pg-veil--still .pg-veil__ghost{display:none}
.pg-veil--still[data-state=sweeping] .pg-veil__halves{animation:pg-veil-fade-in .25s linear forwards;clip-path:none;opacity:0}
.pg-veil--still[data-state=holding] .pg-veil__sheet,.pg-veil--still[data-state=holding] .pg-veil__wisps{animation:none}
.pg-veil--still[data-state=parting] .pg-veil__half--l,.pg-veil--still[data-state=parting] .pg-veil__half--r{animation:pg-veil-fade-out .35s linear forwards}
@keyframes pg-veil-fade-in{to{opacity:1}}
@keyframes pg-veil-fade-out{to{opacity:0}}
`;

const GHOST = `<svg viewBox="0 0 120 150" aria-hidden="true"><defs><radialGradient id="pg-veil-g" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#f2e8d8" stop-opacity=".85"/><stop offset="1" stop-color="#e8dccb" stop-opacity="0"/></radialGradient></defs><path fill="url(#pg-veil-g)" d="M60 4C30 4 12 28 12 60v62c0 6 6 9 11 5l9-8 9 10c3 3 7 3 10 0l9-10 9 10c3 3 7 3 10 0l9-10 9 8c5 4 11 1 11-5V60C108 28 90 4 60 4z"/><ellipse cx="44" cy="58" rx="7" ry="10" fill="#1d1916" opacity=".75"/><ellipse cx="76" cy="58" rx="7" ry="10" fill="#1d1916" opacity=".75"/></svg>`;

const FILTER = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="pg-veil-mist" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="3" seed="7"><animate attributeName="baseFrequency" dur="18s" values="0.006 0.011;0.008 0.009;0.006 0.011" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" scale="70"/></filter></svg>`;

let styleInjected = false;

export function createGhostVeil(host = document.body, opts = {}) {
  const still = opts.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    styleInjected = true;
  }
  const root = document.createElement("div");
  root.className = "pg-veil" + (still ? " pg-veil--still" : "");
  root.style.zIndex = String(opts.zIndex ?? 50);
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `${FILTER}<div class="pg-veil__halves"><div class="pg-veil__half pg-veil__half--l"><div class="pg-veil__sheet"></div><div class="pg-veil__wisps"></div></div><div class="pg-veil__half pg-veil__half--r"><div class="pg-veil__sheet"></div><div class="pg-veil__wisps"></div></div></div><div class="pg-veil__ghost">${GHOST}</div>`;
  host.append(root);

  const m = createVeilMachine();
  root.dataset.state = m.state;
  const waiters = { holding: [], gone: [] };
  m.onChange((s) => {
    root.dataset.state = s;
    for (const resolve of waiters[s] ?? []) resolve();
    if (waiters[s]) waiters[s] = [];
  });
  const halves = root.querySelector(".pg-veil__halves");
  const leftHalf = root.querySelector(".pg-veil__half--l");
  // Animation ends drive the machine, so timing follows the CSS durations. Timers back them up:
  // a background tab (or any browser that skips the animation) still reaches full coverage and
  // still parts, so the transition can never hang half-open.
  const SWEEP_MS = still ? 250 : 1900;
  const PART_MS = still ? 350 : 1500;
  let timer = 0;
  halves.addEventListener("animationend", (e) => { if (e.target === halves) m.coverDone(); });
  leftHalf.addEventListener("animationend", (e) => { if (e.target === leftHalf) m.partDone(); });
  m.onChange((s) => {
    clearTimeout(timer);
    if (s === "sweeping") timer = setTimeout(() => m.coverDone(), SWEEP_MS + 150);
    if (s === "parting") timer = setTimeout(() => m.partDone(), PART_MS + 150);
  });
  const when = (s) => (m.state === s ? Promise.resolve() : new Promise((r) => waiters[s].push(r)));

  return {
    get state() {
      return m.state;
    },
    get covered() {
      return m.isCovered;
    },
    /** Sweep in and hold. Resolves once the screen is fully covered. */
    cover() {
      m.cover();
      return when("holding");
    },
    /** Part the veil. If it's still sweeping in, waits for full coverage first. Resolves when gone. */
    part() {
      m.part();
      return when("gone");
    },
    destroy() {
      root.remove();
    },
  };
}
