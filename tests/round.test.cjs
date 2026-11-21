const {test}=require('node:test');
const assert=require('node:assert/strict');

async function run({gameRound=true, pastExit=false, blocked=false, pauseDecision=false}={}) {
  const {cameraPilot}=await import('../apps/world/painted-door/camera-pilot.mjs');
  const events=[], finishes=[], observations=[];
  let active=true, release;
  const ai={models:{async generateContent(request){
    observations.push(request.contents[0].parts[0].inlineData.data);
    if(pauseDecision) await new Promise(r=>{release=r});
    return {text:JSON.stringify({move:'forward',clearance:{forward:blocked?'blocked':'clear'},robotVisible:true,pastExit,reason:'Test floor observation.'})};
  }}};
  const pilot=cameraPilot({ai,model:'fixture',send:async e=>events.push(e),record:()=>{},finish:async w=>finishes.push(w),fail:e=>{throw e},signal:new AbortController().signal,gameRound,isActive:()=>active});
  const frame=async n=>{await pilot(n,String(n));await new Promise(r=>setImmediate(r));};
  return {frame,events,finishes,observations,close(){active=false;release?.()}};
}
test('continuous round samples fresh frames and runs past two moves',async()=>{
  const p=await run();
  for(let i=1;i<=170;i++)await p.frame(i);
  assert.ok(p.observations.length>=3);assert.equal(new Set(p.observations).size,p.observations.length);
  assert.equal(p.finishes.length,0);
});
test('two visual confirmations of crossing end a round with a robot win',async()=>{
  const p=await run({pastExit:true});
  for(let i=1;i<=150;i++)await p.frame(i);
  assert.deepEqual(p.finishes,['robot']);assert.equal(p.observations.length,2);
  assert.ok(!p.events.some(e=>e.action==='key_down'));
});
test('a blocked step or a decision returned after expiry cannot move the robot',async()=>{
  const p=await run({blocked:true});
  for(let i=1;i<=95;i++)await p.frame(i);
  assert.ok(!p.events.some(e=>e.action==='key_down'));
  const late=await run({pauseDecision:true});await late.frame(43);late.close();await late.frame(44);
  assert.ok(!late.events.some(e=>e.action==='key_down'));
});
