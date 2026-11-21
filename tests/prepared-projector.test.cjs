const {test}=require('node:test');
const assert=require('node:assert/strict');
const moduleUnderTest=import('../apps/world/rehearsal/prepared-player.mjs');

function video() {
  return {hidden:true, paused:true, dataset:{}, readyState:2, duration:12, currentTime:0,
    getAttribute(name){return this[name] ?? null;}, hasAttribute(name){return !!this[name];},
    removeAttribute(name){delete this[name];}, load(){}, pause(){this.paused=true;},
    async play(){this.paused=false;}};
}
function display(createPreparedPlayer,t) {
  t.mock.method(globalThis,'matchMedia',()=>({matches:false}));
  const videos=[video(),video()], surface={dataset:{},hidden:true,querySelectorAll(){return videos;}};
  return {videos,surface,player:createPreparedPlayer(surface)};
}
if(!globalThis.matchMedia) globalThis.matchMedia=()=>({matches:false});
const a='/rehearsal/prepared-media/a.mp4',b='/rehearsal/prepared-media/b.mp4';
const part=(phase,extra={})=>({id:'one',playMode:'prepared-show',phase:'playing',
  prepared:{phase,clipUrl:a,clipStartedAt:1000,clipDurationMs:8000,...extra}});

test('a mid-clip viewer seeks against the server clock; handoff preloads and conceals a swap',async t=>{
  const {createPreparedPlayer}=await moduleUnderTest;
  const {surface,videos,player}=display(createPreparedPlayer,t);
  player.show(part('collecting',{upNext:{clipUrl:a}}),0);
  assert.equal(videos[0].src,a);assert.ok(videos.every(v=>v.hidden));
  const playing=part('playing',{upNext:{clipUrl:b}});
  player.show(playing,2800);
  assert.equal(surface.dataset.cover,'closing');
  assert.ok(videos.every(v=>v.hidden));
  assert.equal(player.show(playing,3500).playing,true);
  assert.ok(Math.abs(videos[0].currentTime-2.5)<.25);
  assert.equal(videos[1].src,b);
  player.show(part('handoff',{upNext:{clipUrl:b}}),4100);
  assert.equal(surface.dataset.cover,'closing');
  player.show(part('handoff',{upNext:{clipUrl:b}}),4800);
  assert.equal(surface.dataset.cover,'dark');assert.ok(videos[0].paused);
  player.show(part('playing',{clipUrl:b,clipStartedAt:4550}),4800);
  assert.equal(surface.dataset.cover,'open');
  assert.ok(videos[0].hidden);assert.equal(videos[1].hidden,false);
  player.show({...playing,phase:'ended'},5300);
  assert.ok(videos.every(v=>v.paused));
  player.show(null,5400);
  assert.ok(surface.hidden);assert.ok(videos.every(v=>!v.src));
});
test('same footage restarted in a later segment cannot jump visibly before the lights go dark',async t=>{
  const {createPreparedPlayer}=await moduleUnderTest;
  const {surface,videos,player}=display(createPreparedPlayer,t);
  player.show(part('playing'),1000);player.show(part('playing'),1700);videos[0].currentTime=6;
  const repeat=part('playing',{clipStartedAt:7000});
  player.show(repeat,7000);assert.equal(surface.dataset.cover,'closing');assert.equal(videos[0].currentTime,6);
  player.show(repeat,7700);assert.equal(surface.dataset.cover,'open');assert.ok(videos[0].currentTime<1);
});
test('clip errors identify a playback failure and never show a simulated success',async t=>{
  const {createPreparedPlayer,preparedCue,preparedTime}=await moduleUnderTest;
  const {videos,player}=display(createPreparedPlayer,t),r=part('playing');
  player.show(r,2000);videos[0].error={code:4};
  const bad=player.show(r,2800);
  assert.match(preparedCue(r.prepared,bad,2800).text,/could not play/);
  assert.equal(preparedTime(9000,1000,4500,10),4.45);
  assert.equal(preparedTime(9000,1000,10000,2),1.95);
  assert.equal(preparedTime(900,1000,1000,10),0);
});
test('fresh generation preserves the original room while waiting and retries a delayed native scene',async t=>{
  const {createPreparedPlayer,preparedCue,usesClipPlayer}=await moduleUnderTest;
  const {videos,surface,player}=display(createPreparedPlayer,t);
  const fresh=extra=>({...part('playing',extra),playMode:'buffered-live',live:true});
  assert.ok(usesClipPlayer(fresh({})));
  const loading = fresh({phase:'collecting',collectUntil:9000,preload:[{clipUrl:a},{clipUrl:b}]});
  player.show(loading,0);player.show(loading,200);
  assert.deepEqual(videos.map(v=>v.src),[a,b]);
  assert.ok(videos.every(v=>v.hidden && v.paused));
  assert.match(player.show(fresh({phase:'collecting',collectUntil:900}),1000).message,/Preparing the first scene/);
  const repair={...fresh({phase:'collecting',collectUntil:900}),playbackMetrics:{rejected:1}};
  assert.match(player.show(repair,1000).message,/Trying your haunting again/);
  assert.match(player.show(fresh({phase:'handoff',clipUrl:null}),1000).message,/Preparing the first scene/);
  assert.equal(surface.dataset.cover,'clear');
  const r=fresh({});
  player.show(r,1600);
  videos[0].error={code:4};
  let reloads=0;videos[0].load=()=>{reloads++;videos[0].error=null;};
  assert.match(player.show(r,2100).message,/next scene/);
  player.show(r,4200);assert.equal(reloads,1);
  assert.equal(player.show(r,5000).playing,true);
  const h=fresh({phase:'handoff',upNext:{title:'A paper storm',clipUrl:b}});
  const notice=preparedCue(h.prepared,player.show(h,5400),5400);
  assert.deepEqual(notice,{label:'Preparing the next scene',text:'A paper storm'});
});

test('both projector slots play at normal speed without jumping over reactions during a slow poll',async t=>{
  const {createPreparedPlayer}=await moduleUnderTest;
  const {videos,player}=display(createPreparedPlayer,t);
  for (const v of videos) v.defaultPlaybackRate=v.playbackRate=1.5;
  const first=part('playing',{upNext:{clipUrl:b}});
  player.show(first,1000);player.show(first,1700);
  assert.deepEqual(videos.map(v=>v.defaultPlaybackRate),[1,1]);
  assert.equal(videos[0].playbackRate,1);
  videos[0].currentTime=2;
  player.show(first,5000);
  assert.equal(videos[0].currentTime,2,'an on-screen reaction must play through');
  player.suspend();
  player.show(first,6000);player.show(first,6700);
  assert.equal(videos[0].currentTime,5.7,'a returning viewer catches up behind the blackout');
  const next=part('playing',{clipUrl:b,clipStartedAt:7200});
  player.show(next,7200);player.show(next,7900);
  assert.equal(videos[1].playbackRate,1);
});

test('a screening choice requires the same filmed encounter to contain an obstacle and a later visible reaction',async()=>{
  const {hasFilmedResponse}=await import('../apps/world/rehearsal/prepared-show.mjs');
  const sha256='a'.repeat(64);
  const clip={role:'effect',frames:240,fps:24,sha256,source:{episodeId:'ep_test'}};
  const evidence={episodeId:'ep_test',clipSha256:sha256,action:'duck',obstacleFrame:72,responseFrame:105,verifiedInPixels:true};
  assert.equal(hasFilmedResponse(clip),false);
  assert.equal(hasFilmedResponse({...clip,reactionEvidence:evidence}),true);
  for(const change of [{verifiedInPixels:false},{action:'injected'},{responseFrame:72},{responseFrame:241},{episodeId:'other'},{clipSha256:'b'.repeat(64)}])
    assert.equal(hasFilmedResponse({...clip,reactionEvidence:{...evidence,...change}}),false);
});

test('a late successor leaves the previous native picture visible until its replacement can decode',async t=>{
  const {createPreparedPlayer}=await moduleUnderTest;
  const {videos,surface,player}=display(createPreparedPlayer,t);
  const fresh=(phase,extra)=>({...part(phase,extra),playMode:'buffered-live'});
  player.show(fresh('playing'),1000);player.show(fresh('playing'),1700);
  assert.equal(videos[0].hidden,false);
  player.show(fresh('waiting'),10000);
  assert.equal(surface.dataset.cover,'open');assert.equal(videos[0].paused,true);
  videos[1].readyState=0;
  player.show(fresh('handoff',{upNext:{clipUrl:b}}),12000);
  player.show(fresh('playing',{clipUrl:b,clipStartedAt:12000}),14000);
  assert.equal(surface.dataset.cover,'open');assert.equal(videos[0].hidden,false);
  videos[1].error={code:3};player.show(fresh('playing',{clipUrl:b,clipStartedAt:12000}),15000);
  assert.equal(surface.dataset.cover,'open');
  videos[1].error=null;videos[1].readyState=2;
  player.show(fresh('playing',{clipUrl:b,clipStartedAt:12000}),16000);
  assert.equal(surface.dataset.cover,'closing');
  player.show(fresh('playing',{clipUrl:b,clipStartedAt:12000}),16800);
  assert.equal(surface.dataset.cover,'open');assert.equal(videos[1].playbackRate,1);
});

test('filmed screening uses the matched original approach exactly once and holds the venue after the guest encounter',async()=>{
  const {preparedLibrary,createPreparedShow}=await import('../apps/world/rehearsal/prepared-show.mjs');
  assert.deepEqual(preparedLibrary.clips.map(clip=>clip.file),['venue-approach.mp4','bat-swarm.mp4']);
  const receipts=[],reactions=[];
  const show=createPreparedShow(0,300000,({id})=>receipts.push(id),30000,({id})=>reactions.push(id));
  const idea={hauntId:'guest-bats',text:preparedLibrary.effectOptions[0].text};
  assert.equal(show.choose(idea,'Misty',27000),true);
  show.advance(30000);show.advance(31250);
  assert.equal(show.state.clipUrl,'/rehearsal/clips/venue-approach.mp4');
  assert.deepEqual(receipts,[]);
  show.advance(48500);show.advance(49750);
  assert.equal(show.state.clipUrl,'/rehearsal/clips/bat-swarm.mp4');
  show.advance(49800);
  assert.deepEqual(receipts,['guest-bats']);
  show.advance(50500);
  assert.deepEqual(reactions,['guest-bats']);
  for (const t of [56750,59000,75000,111000]) {
    show.advance(t);
    assert.equal(show.state.phase,'waiting');
    assert.equal(show.state.clipUrl,'/rehearsal/clips/bat-swarm.mp4');
    assert.equal(show.state.upNext,null);
  }
  assert.deepEqual(receipts,['guest-bats']);
});
