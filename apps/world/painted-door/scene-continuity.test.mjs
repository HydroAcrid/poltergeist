import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import {compareOpening} from './scene-continuity.mjs';

function hallway(shift=0,exposure=0,quality=85) {
  const width=160,height=96,data=Buffer.alloc(width*height*4,255);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const v=(Math.floor((x+shift)/16)+Math.floor(y/24))%2 ? 150 : 47;
    data.set([v+exposure,v-9+exposure,v-20+exposure],4*(y*width+x));
  }
  return jpeg.encode({width,height,data},quality).data;
}
test('a re-encoded continuation keeps the same room across the first second',()=>{
  const same=hallway(0,3,65);
  const review=compareOpening(hallway(),[1,12,24].map(frame=>({frame,bytes:same})));
  assert.equal(review.matches,true);
});
test('a camera that changes its framing after a matching initial image fails the reveal',()=>{
  const reference=hallway();
  const review=compareOpening(reference,[{frame:1,bytes:reference},{frame:12,bytes:hallway(14)}]);
  assert.equal(review.samples[0].consistent,true);
  assert.equal(review.matches,false);
});
