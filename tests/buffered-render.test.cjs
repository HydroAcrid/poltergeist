const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const {setTimeout:sleep} = require('node:timers/promises');

const implementation = import('../apps/world/rehearsal/buffered-render.mjs');
const jpeg = createRequire(resolve(__dirname,'../apps/world/painted-door/package.json'))('jpeg-js');
const picture = frame => {
  const width=64,height=36, data=Buffer.alloc(width*height*4);
  for (let i=0; i<data.length; i+=4) data.set([frame*15,frame*15,frame*15,255],i);
  return jpeg.encode({width,height,data},95).data;
};
const pilot = () => () => ({ action:{key:'A',holdMs:200}, rationale:'Go around the chair', reaction:'avoid' });
const encoder = process.env.PG_FFMPEG_PATH || 'ffmpeg';

async function fixture(t) {
  const captureDir = await mkdtemp(join(tmpdir(),'buffered-render-test-'));
  t.after(() => rm(captureDir,{recursive:true,force:true}));
  const outputDir = join(captureDir,'private-output');
  await mkdir(outputDir);
  return {captureDir, outputDir, episodeId:'episode-fixture', chapter:1, durationMs:1800, seed:picture(1), makePilot:pilot};
}

test('encoder preflight fails before opening a paid session and pre-canceled renders never open', async t => {
  const {renderSegment} = await implementation;
  const opts = await fixture(t);
  const launchLive = () => assert.fail('should not open');
  await assert.rejects(renderSegment({...opts, ffmpegPath:join(opts.captureDir,'missing'), launchLive}), /encoder is unavailable/);
  await assert.rejects(renderSegment({...opts, signal:AbortSignal.abort(), launchLive}), {name:'AbortError'});
  assert.deepEqual(await readdir(opts.outputDir),[]);
});

test('one closed take encodes the complete native archive and timestamps only confirmed outcomes', async t => {
  const {renderSegment,bufferedEncoderReady} = await implementation;
  if (!bufferedEncoderReady()) return t.skip('FFmpeg with libx264 required for the movie check');
  const opts = await fixture(t);
  opts.durationMs=150;
  const pictures=Array.from({length:12},(_,i)=>picture(i+1));
  const commands=[], calls=[], starts=[];
  const shot = (obstacles=[]) => ({visible:true, feetVisible:true, playerMatch:true, playerCount:1, pose:'upright', threat:'ordinary',
    feet:{left:[800,440],right:[800,460]}, ahead:[580,450], obstacles});
  const launchLive = native => {
    assert.equal(native.chapterMs,opts.durationMs);
    assert.equal(native.reactionTailMs,800);
    assert.deepEqual(native.seed,opts.seed);
    setImmediate(async () => {
      try {
        const publish = native.onMessage;
        const observed = (n,scene) => publish({scene, observed:n, observedAt:Date.now(), trackingPlacementReady:true});
        publish({frame:pictures[0].toString('base64'),frameNumber:1});
        assert.equal(commands.length,0); // first media alone cannot place a proposal
        observed(1,{visible:false, playerCount:0, obstacles:[]});
        assert.equal(commands.length,0);
        observed(2,shot());
        await sleep(4);
        observed(3,shot());
        const inject=commands.find(c=>c.haunt);
        assert.equal(inject.haunt.id,'idea-1');
        publish({injected:'idea-1',attempt:1,injectedFrame:3,injectedAt:Date.now()});
        await sleep(4);
        observed(4,shot([{label:'toppled chair',box:[490,425,620,475],solid:true}]));
        publish({navigationMoved:true,observed:4,key:'A',encounter:'idea-1',appliedFrame:5});
        await sleep(opts.durationMs+20);
        publish({reactionTailStarted:true});
        publish({stepReview:{encounter:'idea-1',key:'A',basis:4,appliedFrame:5,observed:9,reason:'post-step pixels'}});
        observed(9,shot([{label:'toppled chair',box:[490,425,620,475],solid:true}]));
        assert.ok(commands.some(command=>command.stepFeedback?.outcome==='still-blocked'));
        // Last two preview frames never arrive over IPC. Both must still be in the movie and checkpoint.
        publish({frame:pictures[9].toString('base64'),frameNumber:10});
        const run=join(opts.captureDir,'runs','photo-round-fixture');
        await mkdir(run,{recursive:true});
        await Promise.all(pictures.map((p,i)=>writeFile(join(run,String(i+1).padStart(5,'0')+'.frame'),p)));
        await writeFile(join(run,'session.json'),JSON.stringify({episodeId:opts.episodeId,chapter:opts.chapter,
          playMode:native.playMode,frames:pictures.length,fps:24,terminal:'completed'}));
        native.onClose('completed');
      } catch(error) {calls.push(error); native.onClose('failed');}
    });
    return {send:c=>commands.push(c),stop:()=>native.onClose('canceled')};
  };
  const result=await renderSegment({...opts, launchLive, reactionTailMs:800, initialFear:1, picks:[{id:'idea-1',text:'A chair tips over',by:'Amber Wisp'}],
    onStart:start=>starts.push(start), makePilot:()=>scene=>{calls.push(scene);return pilot()(scene);}});
  assert.equal(starts.length,1);
  assert.ok(calls.some(scene=>scene.visible), 'the actual pilot callback receives observed pixels interpreted by the tracker');
  assert.equal(result.durationMs,500);
  assert.equal(result.frameCount,12);
  assert.deepEqual(result.finalFrame,pictures[11]);
  assert.equal(result.evidence.winner,null);
  assert.equal(result.evidence.finalFear,1);
  assert.deepEqual(result.evidence.moves,[{observed:4,key:'A'}]);
  const p=result.evidence.picks[0];
  assert.equal(p.deliveredFrame,3);
  assert.equal(p.deliveredOffsetMs,83);
  assert.equal(p.inPathFrame,4);
  assert.equal(p.inPathOffsetMs,125);
  assert.equal(p.visible,true);
  assert.equal(p.reacted,false);
  assert.deepEqual(p.response,{key:'A',basis:4,appliedFrame:5,checkedFrame:9,outcome:'still-blocked'});
  assert.equal(p.reactedOffsetMs,null);
  assert.equal((await stat(result.filePath)).mode & 0o222,0);
  const sourceGray = jpeg.decode(pictures[11]).data[0];
  const movie = execFileSync(encoder,['-v','error','-i',result.filePath,'-f','rawvideo','-pix_fmt','gray','-']);
  assert.equal(movie.length,64*36*12);
  assert.ok(Math.abs(movie[64*36*11]-sourceGray)<=3,'the displayed last frame must agree with the native continuation');
  assert.notDeepEqual(await readFile(result.filePath),pictures[11]);
  await Promise.all([result.dispose(),result.dispose()]);
  assert.deepEqual(await readdir(opts.outputDir),[]);
});

test('early close and abort reject without publishing a movie and wait for native shutdown', async t => {
  const {renderSegment,bufferedEncoderReady}=await implementation;
  if (!bufferedEncoderReady()) return t.skip('encoder preflight unavailable');
  const opts=await fixture(t);
  let starts=0;
  await assert.rejects(renderSegment({...opts,onStart:()=>starts++,launchLive:native=>{
    setImmediate(()=>native.onClose('failed'));return {send(){},stop(){}};
  }}),/without a complete native segment/);
  assert.equal(starts,0);
  const cancel=new AbortController();
  let stopped=0;
  await assert.rejects(renderSegment({...opts,signal:cancel.signal,launchLive:native=>{
    setImmediate(()=>{cancel.abort(Error('host stopped'));cancel.abort();});
    return {send(){},stop(){stopped++;setImmediate(()=>native.onClose('canceled'));}};
  }}),/host stopped/);
  assert.equal(stopped,1);
  assert.deepEqual(await readdir(opts.outputDir),[]);
});

test('the reveal begins on the preceding image, then keeps every new native frame and returns the final one', async t=>{
  const {renderSegment,bufferedEncoderReady}=await implementation;
  if (!bufferedEncoderReady()) return t.skip('H.264 encoder required');
  const opts=await fixture(t), first=picture(4), last=picture(12);
  const sequence=Array.from({length:25},(_,i)=>i===24?last:first);
  const launchLive=native=>{
    setImmediate(async()=>{
      const run=join(opts.captureDir,'runs','photo-round-next');
      await mkdir(run,{recursive:true});
      for (let i=0;i<sequence.length;i++) await writeFile(join(run,String(i+1).padStart(5,'0')+'.frame'),sequence[i]);
      native.onMessage({frame:first.toString('base64')});
      await writeFile(join(run,'session.json'),JSON.stringify({episodeId:opts.episodeId,chapter:2,
        terminal:'completed',fps:24,frames:sequence.length,playMode:native.playMode}));
      native.onClose('completed');
    });
    return {send(){},stop(){}};
  };
  const result=await renderSegment({...opts,seed:first,chapter:2,launchLive});
  assert.equal(result.evidence.continuity.matches,true);
  assert.equal(result.openingHoldFrames,16);
  const decoded=execFileSync(encoder,['-v','error','-i',result.filePath,'-f','rawvideo','-pix_fmt','gray','-']);
  const stride=64*36;
  assert.equal(decoded.length,(sequence.length+16)*stride);
  assert.ok(Math.abs(decoded[0]-jpeg.decode(first).data[0])<=3);
  assert.ok(Math.abs(decoded[15*stride]-jpeg.decode(first).data[0])<=3);
  assert.ok(Math.abs(decoded[(sequence.length+15)*stride]-jpeg.decode(last).data[0])<=3);
  assert.deepEqual(result.finalFrame,last);
  await result.dispose();
});
