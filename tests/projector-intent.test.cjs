const {test}=require('node:test');
const assert=require('node:assert/strict');
const cueModule=import('../apps/world/rehearsal/haunt-cue.mjs');
const prop={id:'bucket',name:'A mop bucket rolls into the middle of the aisle',by:'Sable Attic',
  selectedAt:6100,cueAt:6100,seenAt:19300,inPathPresentedAt:19300,inPath:true,seen:true,placement:'in-path'};
function state(at,key='assess'){
  return {id:'show',chapter:1,phase:'playing',live:true,observed:7,trackedAt:at,trackedBody:[250,65,980,356],
    intent:{at,key,observed:7,hauntId:'bucket'},props:[{...prop}]};
}
test('replays the public bucket cue onsets at +24.9s and +47.5s; the result interrupts the final intent',async()=>{
  const {createProjectorCue,hauntCue}=await cueModule, show=createProjectorCue();
  const checking=state(24900),gap={...checking,observed:8,intent:null,trackedAt:25500};
  assert.equal(show(checking,24900).intent,'Checking the path');
  assert.equal(hauntCue(gap,25500),null);
  assert.equal(show(gap,25500).intent,'Checking the path');
  assert.equal(show(gap,28399).intent,'Checking the path');
  assert.equal(show(gap,28400),null);
  const right=state(47500,'ArrowRight');
  assert.equal(show(right,47500).intent,'Looking for a route on the right');
  assert.equal(show({...right,observed:8},48300).intent,'Looking for a route on the right');
  assert.equal(show({...right,phase:'ended'},49600),null);
});
test('withdraws a held intent for a changed prop, blocked move, lost robot, chapter seam or different round',async()=>{
  const {createProjectorCue}=await cueModule;
  for(const change of [{id:'other'}, {chapter:2}, {trackedBody:null}, {props:[{...prop,inPath:false,placement:'off-path'}]},
    {lastMoveHeld:{key:'D',observed:8}}, {props:[{...prop,reactedAt:25100}],lastReaction:{at:25100,flinch:true}},
    {props:[],upcoming:[{id:'paper',name:'Paper falls',cueAt:25100}]}]) {
    const show=createProjectorCue(),start=state(24900,'D');
    assert.ok(show(start,24900).intent);
    const next=show({...start,observed:8,intent:null,...change},25100);
    assert.equal(next?.intent,undefined);
    if(change.lastReaction) assert.equal(next.label,'The robot flinched');
    if(change.upcoming) assert.equal(next.text,'Paper falls');
  }
});
