const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const moduleUnderTest=import('../apps/world/rehearsal/filmed-review.mjs');

test('reviews each individual encounter before/after plus the actual native cut, without sending audience text',async t=>{
  const {selectReviewFrames,reviewFilmedFrames,filmedVeto}=await moduleUnderTest;
  const evidence={picks:[{text:'secret audience text',inPathFrame:40,response:{basis:48,checkedFrame:80,outcome:'route-open'}},
    {inPathFrame:155,scare:true,reaction:'scare',reactedFrame:197,response:{basis:81,checkedFrame:115,outcome:'still-blocked'}}]};
  const plan=selectReviewFrames(evidence,220,24);
  assert.deepEqual(plan,{pairs:[{index:1,before:48,after:80},{index:2,before:155,after:197}],frames:[48,80,155,197,220],final:220});
  assert.deepEqual(selectReviewFrames({picks:[]},100,24).frames,[52,100]);
  const path=await fs.mkdtemp(join(tmpdir(),'pg-frame-check-'));
  t.after(()=>fs.rm(path,{recursive:true,force:true}));
  const jpeg=f=>Buffer.from([255,216,f,255,217]);
  for(const f of plan.frames)await fs.writeFile(join(path,String(f).padStart(5,'0')+'.frame'),jpeg(f));
  const calls=[];
  let finishArgon;
  const client={models:{generateContent(a){
    calls.push('argon');assert.equal(a.model,'gemini-4-argon');
    assert.deepEqual(a.contents[0].parts.filter(x=>x.inlineData).map(x=>x.inlineData.data),plan.frames.map(f=>jpeg(f).toString('base64')));
    assert.doesNotMatch(JSON.stringify(a),/secret audience text/);
    return new Promise(resolve=>{finishArgon=()=>resolve({text:JSON.stringify({camera:true,event_1:'sidestep',event_2:'scare',extra:'secret model text'})});});
  }},decisions:{async create(d,api,opts){
    calls.push('decisions');assert.equal(d.model,'gemini-decision-1');assert.equal(api,'v1beta');
    assert.equal(opts.retries.strategy,'none');assert.deepEqual(Object.keys(d.questions),['camera','event_1','event_2']);
    assert.doesNotMatch(JSON.stringify(d),/secret audience text/);
    assert.deepEqual(d.input.filter(x=>x.type==='image').map(x=>x.data),plan.frames.map(f=>jpeg(f).toString('base64')));
    finishArgon();return {answers:{camera:{type:'noul',noul:.95},event_1:{type:'choice',choice:'sidestep',confidence:.9},event_2:{type:'choice',choice:'scare',confidence:.89}}};
  }}};
  const result=await reviewFilmedFrames({path,plan,client});
  assert.deepEqual(calls,['argon','decisions']);assert.doesNotMatch(JSON.stringify(result),/secret|image\/jpeg|base64/);
  assert.equal(filmedVeto(evidence,result),null);result.events[1].decisions='none';assert.match(filmedVeto(evidence,result),/reaction/);
  result.camera.decisions=.49;assert.match(filmedVeto(evidence,result),/camera/);
  client.decisions.create=async()=>{throw Error('secret-provider-record');};
  await assert.rejects(reviewFilmedFrames({path,plan,client}),e=>e.code==='VISUAL_REVIEW_UNAVAILABLE' &&
    e.reviewer==='gemini-decision-1' && !e.message.includes('secret'));
});

test('visual agreement cannot create a sidestep, scare or win from unverified native motion',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  const {filmedVeto}=await moduleUnderTest;
  const p={id:'p',inPath:true,delivered:true,visible:true,inPathFrame:4,inPathOffsetMs:125,reacted:false};
  const visualReview={camera:{argon:true,decisions:.95},events:[{index:1,argon:'sidestep',decisions:'sidestep'}]};
  const sight=frame=>({frame,visible:true,subjectTracked:true,playerCount:1,shoulderView:'rear-right',feetVisible:true});
  const evidence={picks:[p],observations:[sight(4),sight(12)],moves:[],finalFear:0,visualReview};
  assert.equal(filmedVeto(evidence,visualReview),null);
  assert.match(reviewSegment({fps:24,frameCount:12,durationMs:500,evidence},[p],0,false).reason,/reacted/);
  assert.equal(p.reacted,false);assert.equal(evidence.finalFear,0);
});
