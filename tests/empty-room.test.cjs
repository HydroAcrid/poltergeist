const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');

const source = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
const generated = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);

function modelsWithReview(review) {
  const calls = [];
  return {
    calls,
    async generateContent(request) {
      calls.push(request);
      if (calls.length === 1) return {
        candidates: [{ content: { parts: [{ inlineData: {
          mimeType: 'image/png', data: generated.toString('base64'),
        } }] } }],
      };
      return { text: review };
    },
  };
}

test('the only generation reference is the venue photo; the presence check sees the resulting room in its actual format', async () => {
  const { generateVerifiedRoom } = await import('../apps/world/rehearsal/photo-plate.mjs');
  const models = modelsWithReview('{"room":"empty"}');
  const room = await generateVerifiedRoom(source, models);
  assert.deepEqual(room, { bytes: generated, mime: 'image/jpeg' });
  assert.equal(models.calls.length, 2);
  assert.equal(models.calls[1].config.httpOptions.apiVersion, 'v1beta');
  const images = (request) => request.contents[0].parts.flatMap(p => p.inlineData ? [p.inlineData] : []);
  assert.deepEqual(images(models.calls[0]), [{ mimeType: 'image/jpeg', data: source.toString('base64') }]);
  assert.deepEqual(images(models.calls[1]), [{ mimeType: 'image/jpeg', data: generated.toString('base64') }]);
});

test('a character, uncertain scene or unrecognised verdict stays unavailable until the host retries', async () => {
  const { createPlateCache, generateVerifiedRoom } = await import('../apps/world/rehearsal/photo-plate.mjs');
  for (const verdict of ['{"room":"character"}', '{"room":"uncertain"}', '{}', 'invalid']) {
    let attempts = 0;
    const assets = createPlateCache({
      generate: ({photo}) => generateVerifiedRoom(photo, modelsWithReview(++attempts === 1 ? verdict : '{"room":"empty"}')),
    });
    const first = assets.prepare('hall', source);
    assert.equal(assets.prepare('hall', source), first);
    await setImmediate();
    assert.equal(first.pending, false);
    assert.equal(first.image, undefined);
    assert.ok(first.error);
    assert.equal(attempts, 1, 'a failed check does not spend on an automatic retry');
    const retry = assets.prepare('hall', source);
    await setImmediate();
    assert.deepEqual(retry.image?.bytes, generated);
    assert.equal(retry.error, undefined);
    assert.equal(assets.prepare('hall', source), retry);
    assert.equal(attempts, 2);
  }
});
