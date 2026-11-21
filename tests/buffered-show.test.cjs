const test = require('node:test');
const assert = require('node:assert/strict');
const settle = () => new Promise(done => setImmediate(done));

const camera = frame => ({frame,playerCount:1,visible:true,subjectTracked:true,feetVisible:true,shoulderView:'rear-right'});
function encounter(id, inPathOffsetMs=2000, scare=false) {
  const basis = 1+Math.round(inPathOffsetMs*24/1000);
  const checkedFrame = basis+60;
  const p = {id,delivered:true,visible:true,inPath:true,inPathFrame:basis,inPathOffsetMs,
    reacted:true,reactedFrame:checkedFrame,reactedOffsetMs:inPathOffsetMs+2500,
    reaction:scare ? 'scare' : 'sidestep',scare};
  if (!scare) p.response={basis,appliedFrame:basis+13,checkedFrame,key:'D',outcome:'route-open'};
  return p;
}
function validEvidence(request, extra) {
  const picks = extra.picks ?? request.picks.map(p => encounter(p.id));
  const observations = [camera(1), ...picks.flatMap(p=>[camera(p.inPathFrame),camera(p.reactedFrame)]),camera(280)];
  const moves = picks.filter(p=>p.response).map(({response:s})=>({observed:s.basis,appliedFrame:s.appliedFrame,key:s.key}));
  if (extra.winner==='robot') {
    observations.push({...camera(200),doorwayProgress:'at-threshold'},{...camera(280),doorwayProgress:'through'});
    moves.push({observed:200,appliedFrame:215,key:'W'});
  }
  observations.sort((a,b)=>a.frame-b.frame);
  return {picks,observations,moves,continuity:{matches:true},finalFear:request.initialFear+picks.filter(p=>p.scare).length,
    winnerFrame:extra.winner ? 280 : null,...extra};
}

async function room() {
  const {createBufferedShow} = await import('../apps/world/rehearsal/buffered-show.mjs');
  let now = 10000;
  const requests=[], receipts=[], ended=[], scares=[], disposed=[], seed=Buffer.from('opening');
  const show=createBufferedShow({id:'match',seed,start:now,deadline:now+300000,clock:()=>now,
    onScare:p=>scares.push(p.id),onFinish:(...v)=>ended.push(v),onReceipt:(...v)=>receipts.push(v),render:opts=>
      new Promise((resolve,reject)=>requests.push({opts,resolve,reject}))});
  async function step(ms=0){ now+=ms;show.advance(now);await settle(); }
  async function complete(i,extra={}){
    const {opts,resolve}=requests[i];
    const finalFrame=Buffer.from('native-end-'+i);
    resolve({durationMs:12000,fps:24,frameCount:288,filePath:'/private/'+i+'.mp4',finalFrame,dispose:()=>disposed.push(i),
      evidence:validEvidence(opts,extra)});
    await settle();
    return finalFrame;
  }
  const pick = id => show.enqueue({hauntId:id,text:'A different audience idea '+id}, 'Velvet Ghost',now);
  return {show,requests,receipts,ended,scares,disposed,seed,step,complete,pick};
}

test('two picks per batch, exact predecessor frames, real playback acknowledgments, and overlapping generation',async()=>{
  const {show,requests,receipts,seed,step,complete,pick,disposed}=await room();
  assert.ok(pick('A'));assert.ok(pick('A'));assert.ok(pick('B'));assert.equal(pick('C'),false);
  await step();assert.equal(requests.length,1);assert.strictEqual(requests[0].opts.seed,seed);
  assert.deepEqual(requests[0].opts.picks.map(p=>p.id),['A','B']);
  assert.ok(pick('C'));await step(4000);assert.equal(requests.length,1);
  const end1=await complete(0,{picks:[encounter('A',2000,true),encounter('B')]});await step();
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

test('fear stays live on the show clock and increases only once at the filmed scare', async()=>{
  const {show,pick,requests,step,scares,complete}=await room();
  pick('startle');pick('sidestep');await step();
  await complete(0,{picks:[
    {...encounter('startle',1500,true),reactedOffsetMs:4500,reactedFrame:109},
    encounter('sidestep'),
  ],finalFear:1});
  await step();await complete(1);await step(30000);await step(1250);
  assert.deepEqual(scares,[]);
  await step(4499);assert.deepEqual(scares,[]);
  await step(1);await step(150);
  assert.deepEqual(scares,['startle']);
  show.stop();if(requests[2])await complete(2);await show.dispose();
});

test('rejected footage stays private and the same batch retries once from the last accepted native frame',async()=>{
  const {show,step,seed,complete,requests,pick,disposed,receipts,ended,scares}=await room();
  await step(8000);
  const lastGood=await complete(0);
  pick('gust');await step(2200);
  const bad=await complete(1,{observations:[{...camera(275),feetVisible:false}]});
  assert.notDeepEqual(bad,lastGood);
  assert.deepEqual(disposed,[1]);assert.equal(show.file(2),undefined);
  assert.equal(show.state.preload.length,1);assert.deepEqual(receipts,[]);
  await step();assert.deepEqual(requests.map(r=>r.opts.chapter),[1,2,3]);
  assert.strictEqual(requests[0].opts.seed,seed);assert.strictEqual(requests[1].opts.seed,lastGood);
  assert.strictEqual(requests[2].opts.seed,lastGood);
  assert.strictEqual(requests[2].opts.picks,requests[1].opts.picks);
  assert.equal(requests[2].opts.initialFear,0);
  await complete(2);assert.equal(show.file(2),'/private/2.mp4');assert.deepEqual(scares,[]);
  assert.equal(show.metrics.rejected,1);assert.equal(show.metrics.generated,2);
  assert.deepEqual(ended,[]);assert.deepEqual(receipts,[]);await show.dispose();
});

test('two unresolved encounters end opening without a winner, a scare or a successful receipt',async()=>{
  const {show,step,complete,requests,pick,disposed,receipts,ended,scares}=await room();
  pick('bucket');await step(2200);
  const unresolved = {...encounter('bucket'),reacted:false,reaction:undefined};
  unresolved.response={key:'D',basis:49,appliedFrame:62,outcome:'unconfirmed'};
  await complete(0,{picks:[unresolved]});await step();
  await complete(1,{picks:[unresolved]});await step();await step(5000);
  assert.equal(requests.length,2);assert.equal(show.file(1),undefined);assert.equal(show.state.preload.length,0);
  assert.deepEqual(disposed,[0,1]);assert.equal(receipts.length,1);assert.equal(receipts[0][1],false);
  assert.match(receipts[0][2],/reacted/);assert.deepEqual(ended,[['interrupted',null]]);
  assert.deepEqual(scares,[]);await show.dispose();
});

test('a usable opening can play after the successor exhausts its one retry',async()=>{
  const {show,step,complete,requests,pick,receipts,ended}=await room();
  await step(8000);await complete(0);
  pick('B');await step(2000);const failure=Object.assign(Error('The next scene opened in a different view of the hallway.'),{code:'HALLWAY_MISMATCH'});
  requests[1].reject(failure);await settle();await step();requests[2].reject(failure);await settle();
  await step(20000);await step(1250);assert.equal(show.file(2),undefined);
  assert.equal(show.state.clipUrl,'/rehearsal/segments/match/1.mp4');
  await step(12000);assert.deepEqual(ended,[['interrupted',null]]);assert.equal(receipts.length,1);
  assert.equal(requests.length,3);await show.dispose();
});

test('an operator stop between visual attempts releases the reservation exactly once',async()=>{
  const {show,step,complete,requests,pick,receipts}=await room();
  pick('A');await step(2000);await complete(0,{observations:[]});
  show.stop();await step(2500);assert.equal(requests.length,1);
  assert.deepEqual(receipts.map(([p,ok])=>[p.id,ok]),[['A',false]]);await show.dispose();
});

test('a measured retreat is valid while a wire acknowledgment, old sighting, or fabricated ending fails',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  function review(extra,picks=[{id:'p'}]) {
    return reviewSegment({frameCount:288,durationMs:12000,fps:24,evidence:validEvidence({picks,initialFear:0},extra)},picks,0,false);
  }
  const retreat=encounter('p');retreat.reacted=false;retreat.reaction=null;
  Object.assign(retreat.response,{key:'S',outcome:'backed-away'});
  assert.equal(review({picks:[retreat]}).ok,true);
  assert.equal(review({picks:[retreat],moves:[]}).ok,false);
  assert.equal(review({picks:[retreat],observations:[camera(1)]}).ok,false);
  assert.equal(review({winner:'audience'}).ok,false);
  assert.equal(review({winner:'robot',moves:[]},[]).ok,false);
  assert.equal(review({winner:'robot'},[]).ok,true);
  assert.equal(review({winner:'robot',observations:[camera(280)]},[]).ok,false);
  assert.equal(review({continuity:{matches:false}},[]).ok,false);
});

test('old bucket and gust cuts fail using their archived final reads and applied movement',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  // photo-round-10tpBU: last independent image 435, actor D applied at 500, native cut 584.
  const bucket={id:'bucket',delivered:true,visible:true,inPath:true,inPathFrame:435,inPathOffsetMs:18083,
    response:{key:'D',basis:435,appliedFrame:500,outcome:'unconfirmed'}};
  const clip={frameCount:584,durationMs:24333,fps:24,evidence:{picks:[bucket],observations:[camera(435)],
    moves:[{observed:435,key:'D',appliedFrame:500}],finalFear:0}};
  assert.match(reviewSegment(clip,[bucket],0,false).reason,/camera lost/i);
  // A healthy last camera by itself still cannot turn that applied D into a bypass.
  assert.match(reviewSegment({...clip,evidence:{...clip.evidence,observations:[camera(435),camera(570)]}},[bucket],0,false).reason,/reacted/i);
  // photo-round-jtsZqE: no native move, both final reads (421,511) report cropped feet.
  const gust={id:'gust',delivered:true,visible:false,inPath:false};
  assert.match(reviewSegment({...clip,evidence:{picks:[gust],observations:[421,511].map(n=>({...camera(n),feetVisible:false})),moves:[],finalFear:0}},[gust],0,false).reason,/camera lost/i);
  assert.match(reviewSegment({...clip,evidence:{picks:[gust],observations:[camera(570)],moves:[],finalFear:0}},[gust],0,false).reason,/walking path/i);
});

test('opening retry has a distinct archive id while still starting from the photo',async()=>{
  const {show,step,complete,requests,seed}=await room();
  await step(8000);await complete(0,{observations:[]});await step();
  assert.equal(requests[1].opts.chapter,2);assert.strictEqual(requests[1].opts.seed,seed);
  assert.equal(requests[1].opts.continuation,false);await complete(1);
  await step();assert.equal(requests[2].opts.continuation,true);
  show.stop();await complete(2);await show.dispose();
});

test('a missed second idea has its own receipt while a filmed encounter or a genuine exit still plays',async()=>{
  for (const exiting of [false,true]) {
    const {show,step,complete,requests,pick,receipts,ended}=await room();
    pick('unseen');if (!exiting) pick('seen');await step(2200);
    const picks=[{id:'unseen',delivered:false,inPath:false}];
    if (!exiting) picks.push(encounter('seen'));
    await complete(0,{picks,...(exiting ? {winner:'robot'} : {})});
    assert.deepEqual(receipts.map(([p,ok])=>[p.id,ok]),[['unseen',false]]);
    await step();
    if (!exiting) await complete(1);
    await step(30000);await step(1250);await step(2200);
    assert.ok(show.file(1));assert.doesNotMatch(show.state.sourceTitle,/unseen/);
    if (exiting) {
      await step(10000);assert.deepEqual(ended,[['exit','robot']]);
      assert.equal(requests.length,1);
    } else {
      assert.deepEqual(receipts.map(([p,ok])=>[p.id,ok]),[['unseen',false],['seen',true]]);
    }
    show.stop();if(requests[2])await complete(2);await show.dispose();
  }
});

test('verified post-step identity supports a reaction while the cut still requires reacquired camera tracking',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  const p=encounter('p');const evidence=validEvidence({picks:[p],initialFear:0},{picks:[p]});
  const sight=evidence.observations.find(s=>s.frame===p.reactedFrame);
  Object.assign(sight,{subjectTracked:false,subjectCompared:true});
  const clip={frameCount:288,durationMs:12000,fps:24,evidence};
  assert.equal(reviewSegment(clip,[p],0,false).ok,true);
  sight.subjectCompared=false;assert.equal(reviewSegment(clip,[p],0,false).ok,false);
  sight.subjectCompared=true;Object.assign(evidence.observations.at(-1),{subjectTracked:false,subjectCompared:true});
  assert.equal(reviewSegment(clip,[p],0,false).ok,false);
});

test('only a filmed third scare can end the match on fear',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  const p=encounter('last',2000,true);
  const evidence=validEvidence({picks:[p],initialFear:2},{picks:[p],winner:'audience',winnerFrame:p.reactedFrame});
  const clip={frameCount:288,fps:24,durationMs:12000,evidence};
  assert.equal(reviewSegment(clip,[p],2,false).winner,'audience');
  evidence.winnerFrame=280;assert.equal(reviewSegment(clip,[p],2,false).ok,false);
  evidence.winner=null;assert.equal(reviewSegment(clip,[p],2,false).ok,false);
});

test('an unavailable film reviewer closes the opening truthfully without retrying a paid world',async()=>{
  const {show,step,requests,ended}=await room();await step(8000);
  const message='Gemini Decisions could not review the recorded frames.';
  requests[0].reject(Object.assign(Error(message),{code:'VISUAL_REVIEW_UNAVAILABLE'}));
  await settle();await step();await step(10000);
  assert.equal(requests.length,1);assert.equal(show.file(1),undefined);
  assert.deepEqual(ended,[['interrupted',null]]);assert.equal(show.error,message);
  await show.dispose();
});
