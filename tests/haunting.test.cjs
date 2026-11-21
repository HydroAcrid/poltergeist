const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../apps/world/painted-door/haunting');

async function openHallway() {
  const elements = new Map();
  const painted = [];
  const context = new Proxy(
    {
      drawImage(image) {
        painted.push(image.src);
      },
    },
    {
      get: (target, key) => target[key] ?? (() => {}),
    },
  );
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        addEventListener() {},
        setAttribute() {},
        getContext: () => context,
      });
    return elements.get(selector);
  };
  let frame,
    now = 0;
  class LocalImage {
    width = 128;
    height = 96;
    async decode() {
      await fs.promises.access(path.join(root, this.src));
    }
  }
  const scope = vm.createContext({
    Image: LocalImage,
    window: { matchMedia: () => ({ matches: false }) },
    document: { querySelector: element, addEventListener() {} },
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frame = undefined;
    },
  });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), scope, {
      filename: src,
    });
  }
  await vm.runInContext('Promise.all([])', scope);
  for (let i = 0; i < 100 && element('#drop').disabled !== false; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(
    element('#status').textContent,
    'Hallway clear.',
    'All prototype assets must load from a fresh checkout',
  );
  return {
    click: (key) => element('#' + key).onclick(),
    status: () => element('#status').textContent,
    paintNext(count) {
      for (let i = 0; i < count; i++) {
        now += 1000 / 60;
        if (frame) {
          painted.length = 0;
          frame(now);
        }
      }
    },
    painted,
  };
}

test('contact triggers a stumble and recovery', async () => {
  const app = await openHallway();
  app.click('drop');
  app.click('walk');
  app.paintNext(123);
  assert.equal(
    app.status(),
    'Slipped on the peel.',
    'Contact must trigger a stumble',
  );
  app.paintNext(100);
  assert.equal(app.status(), 'Back on its feet.');
  app.click('walk');
  app.paintNext(350);
  assert.equal(app.status(), 'Reached the end of the test aisle.');
});

test('step left avoids the peel and reaches the finish', async () => {
  const app = await openHallway();
  app.click('drop');
  app.click('left');
  app.click('walk');
  app.paintNext(450);
  assert.equal(app.status(), 'Reached the end of the test aisle.');
});

test('player sees the persistent peel while the audience sees the brief cue', async () => {
  const app = await openHallway();
  app.click('drop');
  app.paintNext(45);
  assert.ok(
    app.painted.includes('ghost.webp') && app.painted.includes('peel.webp'),
  );
  app.click('robot');
  app.paintNext(1);
  assert.ok(
    !app.painted.includes('ghost.webp') && app.painted.includes('peel.webp'),
  );
  app.click('audience');
  app.paintNext(90);
  assert.ok(
    !app.painted.includes('ghost.webp') && app.painted.includes('peel.webp'),
  );
  app.click('reset');
  assert.equal(app.status(), 'Hallway clear.');
});
