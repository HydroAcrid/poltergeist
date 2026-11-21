import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import jpeg from 'jpeg-js';
import {chapterSeed} from './chapter-seed.mjs';
import {validCheckpoint} from '../rehearsal/chapters.mjs';

test('a saved native frame becomes a fitting landscape JPEG without re-compositing an actor',()=>{
  const original=readFileSync(new URL('../rehearsal/calibration/forward-before.jpg',import.meta.url));
  const result=Buffer.from(chapterSeed(original.toString('base64')),'base64');
  assert.ok(validCheckpoint(result));
  const before=jpeg.decode(original),after=jpeg.decode(result);
  assert.ok(Math.abs(before.width/before.height-after.width/after.height)<.005);
  assert.equal(chapterSeed(result.toString('base64')),result.toString('base64'));
  assert.equal(chapterSeed(Buffer.from('short invalid frame').toString('base64')),null);
});
