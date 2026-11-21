const test = require('node:test');
const assert = require('node:assert/strict');
const settle = () => new Promise(done => setImmediate(done));

async function room() {
  const {createBufferedShow} = await import('../apps/world/rehearsal/buffered-show.mjs');
  let now = 10000;
  const requests=[], receipts=[], ended=[], disposed=[], seed=Buffer.from('opening');
  const show=createBufferedShow({id:'match',seed,start:now,deadline:now+300000,clock:()=>now,
    onFinish:(...v)=>ended.push(v),onReceipt:(...v)=>receipts.push(v),render:opts=>
      new Promise((resolve,reject)=>requests.push({opts,resolve,reject}))});
  async function step(ms=0){ now+=ms;show.advance(now);await settle(); }
  async function complete(i,extra={}){
    const {opts,resolve}=requests[i];
    const finalFrame=Buffer.from('native-end-'+i);
    resolve({durationMs:12000,filePath:'/private/'+i+'.mp4',finalFrame,dispose:()=>disposed.push(i),
      evidence:{picks:opts.picks.map(p=>({id:p.id,inPath:true,inPathOffsetMs:2000})),...extra}});
    await settle();
    return finalFrame;
  }
  const pick = id => show.enqueue({hauntId:id,text:'A different audience idea '+id}, 'Velvet Ghost',now);
  return {show,requests,receipts,ended,disposed,seed,step,complete,pick};
}

test('two picks per batch, exact predecessor frames, real playback acknowledgments, and overlapping generation',async()=>{
  const {show,requests,receipts,seed,step,complete,pick,disposed}=await room();
  assert.ok(pick('A'));assert.ok(pick('A'));assert.ok(pick('B'));assert.equal(pick('C'),false);
  await step();assert.equal(requests.length,1);assert.strictEqual(requests[0].opts.seed,seed);
  assert.deepEqual(requests[0].opts.picks.map(p=>p.id),['A','B']);
  assert.ok(pick('C'));await step(4000);assert.equal(requests.length,1);
  const end1=await complete(0,{finalFear:1});await step();
  assert.strictEqual(requests[1].opts.seed,end1);assert.equal(requests[1].opts.initialFear,1);
  const end2=await complete(1);
  await step(26000);assert.equal(show.state.phase,'handoff');await step(1250);
  assert.equal(show.state.phase,'playing');assert.equal(show.file(1),'/private/0.mp4');assert.equal(receipts.length,0);
  await step(100);assert.strictEqual(requests[2].opts.seed,end2);
  await step(1900);assert.deepEqual(receipts.map(r=>[r[0].id,r[1]]),[['A',true],['B',true]]);
  await complete(2);await step(10000);await step(1250);assert.equal(show.state.clipUrl,'/rehearsal/segments/match/2.mp4');
  await step(2200);assert.equal(receipts.at(-1)[0].id,'C');
  show.stop();if(requests[3]) await complete(3);await show.dispose();
  assert.deepEqual(disposed.sort(),requests.map((_,i)=>i));
});
test('a slow successor waits behind blackout and never reuses an old segment',async()=>{
  const {show,step,complete,requests,ended}=await room();
  await step(8000);await complete(0);await step();await complete(1);await step(22000);await step(1250);
  await step();await step(12000);await step(1250);await step(12000);await step(2250);
  assert.equal(show.state.phase,'handoff');assert.equal(show.metrics.playbackGaps,1);
  await complete(2,{winner:'robot'});await step(1000);
  assert.equal(show.state.clipUrl,'/rehearsal/segments/match/3.mp4');
  assert.deepEqual(ended,[]);await step(12000);assert.deepEqual(ended,[['exit','robot']]);
  assert.equal(requests.length,3);await show.dispose();
});
test('failed first segment gives no winner, no duplicate paid retries, and no audience success receipt',async()=>{
  const {show,pick,step,requests,receipts,ended}=await room();
  pick('A');await step(2200);requests[0].reject(Error('unavailable'));await settle();
  await step();assert.deepEqual(ended,[['interrupted',null]]);assert.equal(receipts[0][1],false);
  await step(22000);assert.equal(requests.length,1);await show.dispose();
});
test('canceling a generation discards its eventual clip and never starts another',async()=>{
  const {show,pick,step,requests,receipts,complete,disposed}=await room();
  pick('A');await step(2200);show.stop();assert.equal(requests[0].opts.signal.aborted,true);
  await complete(0);await show.dispose();assert.deepEqual(disposed,[0]);assert.equal(receipts[0][1],false);assert.equal(show.file(1),undefined);
});

test('waiting past the collection timer cannot open on only one finished render',async()=>{
  const {show,requests,step,complete}=await room();
  await step(8000);await complete(0);await step();
  await step(32000);
  assert.equal(requests.length,2);
  assert.equal(show.state.phase,'collecting','opening requires two playable segments');
  assert.equal(show.metrics.played,0);
  await complete(1);
  assert.equal(show.state.preload.length,2);
  await step();await step(1250);assert.equal(show.state.phase,'playing');
  const first=show.state.clipUrl;await step();
  assert.equal(requests.length,3,'refill starts while the first clip is playing');
  await step(12000);await step(1250);
  assert.notEqual(show.state.clipUrl,first);assert.equal(show.metrics.playbackGaps,0);
  show.stop();await complete(2);await show.dispose();
});
