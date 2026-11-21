const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {EventEmitter} = require('node:events');

function image(mark) {
  const data=Buffer.alloc(200,mark);
  data.writeUInt16BE(0xffd8,0);
  data.writeUInt16BE(0xffd9,data.length-2);
  return data;
}
const scene = {
  playerCount:1,playerMatch:true,visible:true,shoulderView:'rear-right',aisleHeading:'diagonal-right',
  feetVisible:true,feet:{left:[912,197],right:[920,230]},bodyBox:[343,65,924,351],
  rightFloorVisible:true,ahead:[718,553],pose:'upright',threat:'ordinary',obstacles:[],
};

async function stage(t,timing={matchMs:8000,cutMs:3000,limitMs:6000},chapters=true,options={}) {
  t.mock.timers.enable({apis:['Date','setInterval'],now:1000000});
  const {registerStage}=await import('../apps/world/rehearsal/server.mjs');
  const routes=new Map(),events=[],providers=[];
  let dispatch, pilots=0, reviews=0;
  const app={get:(p,h)=>routes.set(p,h),post:(p,h)=>routes.set(p,h),addContentTypeParser(){},
    addHook:(name,fn)=>{if(name==='onClose') t.after(fn);}};
  const current=await registerStage(app,{root:resolve(__dirname,'../apps/world/rehearsal'),captureDir:__dirname,
    chapterTiming:timing,reviewSeed:async()=>{
      reviews++;
      if (options.reviewMs) t.mock.timers.tick(options.reviewMs);
      return {passes:true};
    },newId:()=>'one-match',
    makePilot:()=>{pilots++;return ()=>({action:{key:'W',holdMs:100},rationale:'Advancing'});},
    bus:{publish(type,lane,data){events.push({type,lane,...data});},subscribe(_,cb){dispatch=cb;return()=>{};}},
    launchLive(args) {
      assert.ok(providers.every(p=>p.closed),'providers must never overlap');
      const provider={...args,commands:[],stops:0,closed:false,close(terminal){this.closed=true;this.onClose(terminal);}};
      providers.push(provider);
      return {send:command=>provider.commands.push(command),stop:()=>provider.stops++};
    }});
  async function call(name,body,headers={'x-show-control':'1'},query) {
    let status=200;
    const reply={code(n){status=n;return this;},send(payload){return payload;}};
    const data=await routes.get('/rehearsal/'+name)({headers,body,query},reply);
    return {status,data};
  }
  await call('reset-photo');
  if (options.lobbyMs) t.mock.timers.tick(options.lobbyMs);
  const clickedAt=Date.now();
  if (options.autoStart!==false) {
    const started=await call('start',{mode:'genie',chapters,seed:image(0).toString('base64'),showMinutes:options.showMinutes});
    assert.equal(started.status,200);
    t.mock.timers.tick(150);
  }
  const frame=(provider,mark)=>provider.onMessage({frame:image(mark).toString('base64')});
  const read=(provider,n,mark=1,patch={})=>provider.onMessage({
    scene:{...scene,...patch},observed:n,observedAt:Date.now(),trackingPlacementReady:true,
    trackingNavigationHeld:false,checkpoint:image(mark).toString('base64')
  });
  async function feed(query) {
    let status=200;
    const stream=Object.assign(new EventEmitter(),{frames:[],closed:false,writableLength:0,
      writeHead(){},write(chunk){if (Buffer.isBuffer(chunk)) this.frames.push(chunk);},
      end(){this.closed=true;this.emit('close');}});
    const reply={raw:stream,hijack(){},code(n){status=n;return this;},send(){}};
    await routes.get('/rehearsal/video')({query},reply);
    return {status,stream};
  }
  return {current,providers,events,call,feed,frame,read,clickedAt,reviews:()=>reviews,pilots:()=>pilots,
    submit(id){dispatch({type:'haunt.dispatch',payload:{episodeId:current().id,hauntId:id,text:'A small rolling ball'}});},
    tick:ms=>t.mock.timers.tick(ms)};
}

test('one host match spans two nonoverlapping provider worlds, preserving clock, Brain, props and scores',async t=>{
  const h=await stage(t);
  const a=h.providers[0];
  assert.equal(h.current().remainingMs,8000);
  h.tick(1500); // initial generation consumes no match time
  assert.equal(h.current().phase,'preparing');
  h.frame(a,0);
  const began=h.current().startedAt;
  assert.equal(h.current().chapter,1);
  h.read(a,11,1);
  assert.ok(a.commands.some(c=>c.key==='W'));
  h.current().fear=1; // previously earned, tested independently by placement and Crowd
  h.tick(3000);
  assert.ok(a.commands.some(c=>c.settleCamera));
  assert.equal(h.current().phase,'playing','pre-cut photos cannot be substituted for the settled source');
  h.read(a,71,2);
  h.tick(150);
  const outgoing=await h.feed({round:'one-match',chapter:'1'});
  assert.equal(outgoing.status,200);
  assert.equal((await h.feed({round:'one-match'})).status,409);
  const saved=h.current().remainingMs;
  assert.equal(h.current().phase,'handoff');
  assert.equal(a.stops,1);
  h.submit('queued-in-blackout');
  assert.equal(a.commands.some(c=>c.haunt),false);
  h.tick(1200);
  assert.equal(h.providers.length,1);
  assert.equal(h.current().remainingMs,saved);
  a.onMessage({winner:'audience'});
  assert.equal(h.events.filter(e=>e.type==='episode.ended').length,0);
  a.close('completed');
  h.tick(150);
  assert.equal(h.providers.length,2);
  const b=h.providers[1];
  assert.equal(b.chapter,2);
  assert.deepEqual(b.seed,image(2));
  assert.equal(a.episodeId,b.episodeId);
  assert.equal(h.current().chapter,1);
  h.tick(900);
  assert.equal(h.current().remainingMs,saved);
  h.frame(b,2);
  assert.equal(h.current().chapter,2);
  assert.equal(outgoing.stream.closed,true);
  assert.deepEqual(outgoing.stream.frames,[image(0)]);
  const incoming=await h.feed({round:'one-match',chapter:'2'});
  assert.equal(incoming.status,200);
  assert.deepEqual(incoming.stream.frames,[image(2)]);
  assert.equal(h.current().startedAt,began);
  assert.equal(h.current().deadline,Date.now()+saved);
  assert.equal(h.current().fear,1);
  assert.equal(h.pilots(),1);
  assert.equal((await h.call('video',undefined,{}, {round:'one-match',chapter:'1'})).status,409);
  a.onMessage({frame:image(8).toString('base64'),winner:'robot'});
  a.onClose('failed'); // duplicate callback from retired provider
  h.read(b,1);
  h.tick(1950);
  h.read(b,28);
  assert.equal(h.current().observed,28);
  const delivered=b.commands.filter(c=>c.haunt);
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].haunt.id,'queued-in-blackout');
  assert.equal(delivered[0].haunt.observed,28);
  assert.equal(h.current().props[0].chapter,2);
  h.tick(h.current().deadline-Date.now());
  assert.equal(h.current().phase,'ended');
  assert.equal(h.current().reason,'time');
  assert.equal(h.current().winner,'audience');
  const ended=h.events.filter(e=>e.type==='episode.ended');
  assert.equal(ended.length,1);
  assert.equal(ended[0].durationMs,8000);
  assert.equal(h.events.filter(e=>e.type==='episode.started').length,1);
  b.close('completed');
});

test('a missing or ambiguous native checkpoint interrupts at the chapter ceiling without inventing a winner',async t=>{
  const h=await stage(t);
  const a=h.providers[0];h.frame(a,0);
  h.read(a,1);h.tick(3000);
  h.read(a,71,2,{playerCount:2});
  h.tick(3000);
  assert.equal(h.current().phase,'ended');
  assert.equal(h.current().winner,null);
  assert.equal(h.current().reason,'interrupted');
  assert.equal(h.events.filter(e=>e.type==='episode.ended').length,1);
  a.close('completed');h.tick(500);
  assert.equal(h.providers.length,1);
});

test('unconfirmed provider close during a blackout never launches a replacement; operator can stop before reopening',async t=>{
  const h=await stage(t); const a=h.providers[0]; h.frame(a,0);
  h.tick(3000); h.read(a,71); h.tick(150);
  a.close('cancel-requested');
  assert.equal(h.current().reason,'interrupted');
  assert.equal((await h.call('state')).data.providerClosing,true);
  h.tick(500);
  assert.equal(h.providers.length,1);
});

test('host stop during verified close prevents queued launch and preserves the frozen time',async t=>{
  const h=await stage(t); const a=h.providers[0]; h.frame(a,0);
  h.tick(3000); h.read(a,71); h.tick(150);
  const remaining=h.current().remainingMs;
  const blackout=await h.feed({round:h.current().id,chapter:'1'});
  a.close('completed');
  assert.equal((await h.call('stop',{},{})).status,403);
  assert.equal((await h.call('stop',{})).status,200);
  assert.equal(h.current().remainingMs,remaining);
  assert.equal(blackout.stream.closed,true);
  assert.equal((await h.feed({round:h.current().id,chapter:'1'})).status,409);
  assert.equal(h.current().winner,null);
  h.tick(450);
  assert.equal(h.providers.length,1);
  assert.equal((await h.call('state')).data.providerClosing,false);
});

test('unsettled sent audience effect closes as an explicit failure at the limit, never replayed twice',async t=>{
  const h=await stage(t); const a=h.providers[0]; h.frame(a,0);
  h.submit('in-flight');h.tick(1900);h.read(a,20);
  assert.equal(a.commands.filter(c=>c.haunt).length,1);
  h.tick(1500);h.read(a,71);h.tick(3000);
  assert.equal(h.current().reason,'interrupted');
  assert.equal(h.current().props[0].placement,'failed');
  assert.equal(h.events.filter(e=>e.type==='haunt.injected' && e.ok===false).length,1);
  a.close('completed');h.tick(450);
  assert.equal(h.providers.length,1);
});


test('single-world projector round-only stream remains usable',async t=>{
  const h=await stage(t,undefined,false);
  h.frame(h.providers[0],3);
  const result=await h.feed({round:h.current().id});
  assert.equal(result.status,200);
  assert.deepEqual(result.stream.frames,[image(3)]);
  assert.equal((await h.feed({round:'wrong'})).status,409);
});

test('ten active minutes span several independently closed worlds with exactly one final result',async t=>{
  const {matchDurationMs,chapterCutMs,chapterLimitMs}=await import('../apps/world/rehearsal/chapters.mjs');
  const h=await stage(t,{matchMs:matchDurationMs,cutMs:chapterCutMs,limitMs:chapterLimitMs});
  h.tick(2000);
  let provider=h.providers[0];
  h.frame(provider,1);
  while (h.current().remainingMs>chapterLimitMs) {
    h.tick(chapterCutMs);
    h.read(provider,71);
    h.tick(150);
    assert.equal(h.current().phase,'handoff');
    provider.close('completed');
    h.tick(150);
    provider=h.providers.at(-1);
    h.tick(3000);
    h.frame(provider,1);
  }
  h.tick(h.current().deadline-Date.now());
  assert.equal(h.current().winner,'audience');
  assert.equal(h.current().remainingMs,0);
  assert.ok(h.providers.length>2);
  const ends=h.events.filter(e=>e.type==='episode.ended');
  assert.equal(ends.length,1);
  assert.equal(ends[0].durationMs,600000);
  provider.close('completed');
});


test('five-minute show starts at the host request, counting seed review and generation but excluding lobby time',async t=>{
  const h=await stage(t,undefined,true,{showMinutes:5,lobbyMs:30000,reviewMs:2000});
  const r=h.current(), cutoff=h.clickedAt+300000;
  assert.equal(r.showStartedAt,h.clickedAt);
  assert.equal(r.showDeadline,cutoff);
  assert.equal(r.durationMs,300000);
  assert.equal(r.clockMode,'wall');
  assert.equal(r.showMinutes,5);
  assert.equal(r.deadline,cutoff);
  assert.equal(r.phase,'preparing');
  assert.equal(h.events.length,0);
  h.tick(2400);
  const p=h.providers[0];
  h.frame(p,1);
  assert.equal(r.remainingMs,cutoff-Date.now());
  assert.equal(r.startedAt,Date.now());
  assert.equal(h.events[0].startedAt+h.events[0].maxDurationMs,cutoff);
  assert.equal(r.deadline,cutoff);
  h.tick(cutoff-Date.now()+30);
  assert.equal(r.finishedAt,cutoff);
  assert.equal(r.remainingMs,0);
  assert.equal(r.reason,'time');
  assert.equal(r.winner,'audience');
  p.close('completed');
  h.frame(p,8);
  assert.deepEqual(h.events.filter(e=>e.type==='episode.ended').map(e=>e.durationMs),[cutoff-r.startedAt]);
});

for (const at of ['draining','opening next','playing next']) {
  test('five-minute wall deadline wins once while '+at+' with no stale chapter restart',async t=>{
    const h=await stage(t,{matchMs:600000,cutMs:290000,limitMs:295000},true,{showMinutes:5});
    const r=h.current(),a=h.providers[0],cutoff=r.showDeadline;
    h.frame(a,1);
    h.tick(290000);
    h.read(a,71);
    h.tick(150);
    assert.equal(r.phase,'handoff');
    assert.equal(r.deadline,cutoff,'the five-minute blackout clock keeps counting');
    const before=r.remainingMs;
    h.tick(1200);
    assert.equal(r.remainingMs,before-1200);
    if (at!=='draining') {
      a.close('completed');
      h.tick(150);
      assert.equal(h.providers.length,2);
      if (at==='playing next') {
        h.frame(h.providers[1],2);
        assert.equal(r.deadline,cutoff);
      }
    }
    h.tick(cutoff-Date.now());
    assert.equal(r.phase,'ended');
    assert.equal(r.finishedAt,cutoff);
    assert.equal(r.remainingMs,0);
    assert.equal(r.winner,'audience');
    const count=at==='draining'?1:2;
    for(const p of h.providers) {
      p.close('completed');
      p.onMessage({winner:'robot',frame:image(1).toString('base64')});
    }
    h.tick(3000);
    assert.equal(h.providers.length,count);
    assert.equal(h.events.filter(e=>e.type==='episode.started').length,1);
    assert.equal(h.events.filter(e=>e.type==='episode.ended').length,1);
  });
}

test('no native play before the wall deadline cannot create a win or publish a scored episode',async t=>{
  const h=await stage(t,undefined,true,{showMinutes:5});
  const p=h.providers[0],r=h.current();
  h.tick(r.showDeadline-Date.now());
  assert.equal(r.phase,'ended');
  assert.equal(r.reason,'interrupted');
  assert.equal(r.winner,null);
  assert.equal(r.remainingMs,0);
  assert.equal(r.finishedAt,r.showDeadline);
  assert.equal(p.stops,1);
  h.frame(p,1);
  p.close('completed');
  assert.equal(h.events.length,0);
});

test('invalid show length or incompatible mode never requests seed review, provider use or a round id',async t=>{
  const h=await stage(t,undefined,true,{autoStart:false});
  const body={mode:'genie',chapters:true,seed:image(0).toString('base64')};
  for (const bad of [0,4,6,15,'5',null,{},false])
    assert.equal((await h.call('start',{...body,showMinutes:bad})).status,400);
  for (const change of [{mode:'offline'},{chapters:false}])
    assert.equal((await h.call('start',{...body,...change,showMinutes:5})).status,400);
  assert.equal(h.reviews(),0);
  assert.equal(h.current(),null);
  assert.equal(h.providers.length,0);
  assert.equal((await h.call('start',{...body,showMinutes:10})).status,200);
  assert.equal(h.current().showMinutes,10);
  assert.equal(h.current().clockMode,'active');
});

test('seed review that uses the entire show window never opens a provider afterwards',async t=>{
  const h=await stage(t,undefined,true,{autoStart:false,reviewMs:300000});
  const result=await h.call('start',{mode:'genie',chapters:true,seed:image(0).toString('base64'),showMinutes:5});
  assert.equal(result.status,408);
  assert.equal(h.current(),null);
  h.tick(150);
  assert.equal(h.providers.length,0);
  assert.equal(h.events.length,0);
});

test('a provider close arriving after the wall deadline cannot schedule another chapter before the next server tick',async t=>{
  const h=await stage(t,{matchMs:600000,cutMs:290000,limitMs:295000},true,{showMinutes:5});
  const a=h.providers[0],r=h.current();
  h.frame(a,1);h.tick(290000);h.read(a,71);h.tick(150);
  assert.equal(r.phase,'handoff');
  t.mock.timers.setTime(r.showDeadline+10);
  a.close('completed');
  assert.equal(r.reason,'time');
  assert.equal(r.finishedAt,r.showDeadline);
  h.tick(150);
  assert.equal(h.providers.length,1);
  assert.equal(h.events.filter(e=>e.type==='episode.ended').length,1);
});
