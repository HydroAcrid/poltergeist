const test=require('node:test');
const assert=require('node:assert/strict');
const streaming=import('../apps/world/rehearsal/video-stream.mjs');

function manualClock() {
  let time=0, timer;
  return {now:()=>time, schedule(fn,delay) {assert.equal(timer,undefined);timer={fn,at:time+delay};return timer;},
    cancel(){timer=undefined;},
    move(end) {
      while(timer && timer.at<=end) {const next=timer;timer=undefined;time=next.at;next.fn();}
      time=end;
    }};
}
test('one slow viewer resumes with the latest complete JPEG', async () => {
  const {frameSink}=await streaming;
  const writes=[];let drained;
  const slow=frameSink((frame,done)=>{writes.push(frame);drained=done;});
  const fast=[];const other=frameSink((frame,done)=>{fast.push(frame);done();});
  for(let frame=1;frame<=6;frame++){slow.offer(frame);other.offer(frame);}
  assert.deepEqual(writes,[1]);assert.deepEqual(fast,[1,2,3,4,5,6]);
  drained();assert.deepEqual(writes,[1,6]);
  slow.offer(7);slow.close();drained();assert.deepEqual(writes,[1,6]);
});
test('the capture bridge preserves ordinary native bursts and limits outstanding work', async () => {
  const {frameSink}=await streaming;
  const writes=[];let drain;
  const pipe=frameSink((part,cb)=>{writes.push(part);drain=cb;},6);
  for(let i=1;i<=4;i++)pipe.offer(i);
  for(let i=0;i<4;i++)drain();
  assert.deepEqual(writes,[1,2,3,4]);
  for(let i=5;i<=15;i++)pipe.offer(i);
  for(let i=0;i<7;i++)drain();
  assert.deepEqual(writes.slice(4),[5,10,11,12,13,14,15]);
});
test('a four-frame provider burst is presented in source order at the 24 fps cadence', async () => {
  const {createPlayout}=await streaming, clock=manualClock(),screen=[];
  const player=createPlayout(number=>screen.push([number,clock.now()]),clock);
  for(let burst=0;burst<12;burst++) {
    clock.move(burst*1000/6);
    for(let j=1;j<=4;j++){const n=burst*4+j;player.push(n,n);}
  }
  clock.move(2300);
  assert.deepEqual(screen.map(([n])=>n),Array.from({length:48},(_,i)=>i+1));
  for(let i=2;i<screen.length;i++)assert.ok(Math.abs(screen[i][1]-screen[i-1][1]-1000/24)<=1);
  // Joining sees a picture before the queue begins pacing motion.
  assert.equal(screen[0][1],0);
});
test('a restarted chapter or a delayed source discards obsolete pending imagery', async () => {
  const {createPlayout}=await streaming,clock=manualClock(),screen=[];
  const player=createPlayout(frame=>screen.push(frame),clock);
  player.push('old 1',1);player.push('old 2',2);player.reset();
  player.push('new 1',1);clock.move(1200);player.push('latest',2);
  player.push('old retransmission',1);clock.move(1600);
  assert.deepEqual(screen,['old 1','new 1','latest']);
});
