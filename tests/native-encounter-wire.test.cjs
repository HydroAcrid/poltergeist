const test = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtemp,symlink,rm,readdir,readFile} = require('node:fs/promises');
const {join,resolve} = require('node:path');
const {tmpdir} = require('node:os');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {setTimeout:sleep} = require('node:timers/promises');
const {createRequire} = require('node:module');

const repo = resolve(__dirname,'..');
const native = join(repo,'apps/world/painted-door');
const captureRequire = createRequire(join(native,'package.json'));
const sdkRequire = createRequire(captureRequire.resolve('@google/genai'));
const {WebSocketServer} = sdkRequire('ws');
const jpeg = captureRequire('jpeg-js');

function picture(placed) {
  const width=128,height=72,data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const gray=38+(x*3+y*7+x*y)%100;
    const obstacle=placed && x>=48 && x<=49 && y>=44 && y<=51;
    data.set(obstacle ? [252,208,28,255] : [gray,gray,gray,255],i);
  }
  return jpeg.encode({width,height,data},70).data.toString('base64');
}

async function eventually(fn, ms=10_000) {
  const end=Date.now()+ms;
  let result;
  while(Date.now()<end) {
    result=await fn();
    if(result) return result;
    await sleep(50);
  }
  throw Error('Timed out waiting for the local rehearsal');
}

test('the normal Crowd, Brain and World send one stationary encounter response through the SDK WebSocket', {timeout:40_000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'pg-encounter-wire-'));
  await symlink(join(native,'capture.mjs'),join(dir,'capture.mjs'));
  await symlink(join(native,'node_modules'),join(dir,'node_modules'));
  const empty=picture(false),blocked=picture(true);
  const wire=[]; let current=empty, frames=0, timer;
  const visionReads=[];
  const provider=createServer(async(req,res)=>{
    let body='';for await(const part of req) body+=part;
    const payload=JSON.parse(body||'{}');
    let value;
    if(req.url.endsWith('/interactions')) value={id:'wire-fixture',status:'in_progress'};
    else if(req.url.includes(':generateContent')) {
      const parts=payload.contents.flatMap(c=>c.parts);
      const images=parts.filter(p=>p.inlineData);
      const input=images.at(-1).inlineData.data;
      const placement=input===blocked;
      let result;
      if(payload.generationConfig.responseJsonSchema.properties.view) {
        result={playerCount:1,view:'right-shoulder',routeVisible:true,diagonal:true,standingOnFloor:true,bodyBox:[270,65,950,355]};
      } else {
        assert.ok(input===empty || placement);
        const instructions=parts.filter(part=>part.text).map(part=>part.text).join(' ');
        visionReads.push({placement,frames,at:Date.now(),
          informed:instructions.includes('actually sent to the player was to sidestep left'),
          knowsOutcome:instructions.includes('last checked frame still showed the obstacle'),
          imageCount:images.length,
          leaked:instructions.includes('A small cart rolls across the aisle.')});
        // Sri measured 3.1–4.7 seconds between native observations. Include
        // delayed pixel reads instead of advancing World and Brain in lockstep.
        await sleep(visionReads.length % 2 ? 2670 : 3150);
        result={intent:placement?'step_left':'hold',avoiding:placement,change:placement?'A small cart occupies the next step.':'The aisle is clear.',
          reason:placement?'Clear floor to the left.':'Look down the aisle.',target:[650,180],playerCount:1,robotVisible:true,
          playerMatch:true,shoulderView:'rear-right',aisleHeading:'diagonal-right',goalVisible:true,rightFloorVisible:true,
          feetVisible:true,doorwayProgress:'approaching',bodyBox:[270,65,950,355],upperBodyBox:[290,104,600,319],
          left:[935,186],right:[935,228],goal:[330,600],ahead:[660,400],pose:'upright',threat:'ordinary',
          obstacles:placement?[{label:'small cart',box:[610,376,715,393],relation:'ordinary',solid:true}]:[]};
      }
      value={candidates:[{content:{role:'model',parts:[{text:JSON.stringify(result)}]},finishReason:'STOP'}]};
    } else {
      res.writeHead(404);res.end();return;
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
  });
  const sockets=new WebSocketServer({server:provider});
  sockets.on('connection',socket=>socket.on('message',buffer=>{
    const event=JSON.parse(buffer);
    wire.push({event,frame:frames});
    if(event.event_type==='world_setup') {
      timer=setInterval(()=>{
        ++frames;
        socket.send(JSON.stringify({event_type:'content.delta',delta:{type:'image',mime_type:'image/jpeg',data:current}}));
      },1000/24);
    }
    if(event.event_type==='input' && event.content[0].text.includes('planned next footfall')) current=blocked;
    if(event.event_type==='interaction.complete' || event.event_type==='interaction.cancel') {
      clearInterval(timer);socket.send(JSON.stringify({event_type:'interaction.completed'}));
    }
  }));
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const portProbe=createServer();
  await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));
  const port=portProbe.address().port;
  await new Promise(r=>portProbe.close(r));
  // The World and the actual Google SDK use only the two loopback listeners.
  // Provide a deliberately noncredential value. Never load a developer env file.
  const host=spawn(process.execPath,[join(repo,'apps/world/rehearsal/run.mjs'),'--genie'],{
    cwd:repo,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,PG_CAPTURE_DIR:dir,PG_WORLD_ENV_FILE:join(dir,'unused.env'),
      PG_STAGE_PORT:String(port),PG_BIND_HOST:'127.0.0.1',PG_HAUNT_INTERVAL_MS:'1000',PG_REHEARSAL_LIVE_MS:'30000',
      PG_HAUNT_MAX_PER_EPISODE:'1',PG_MODERATION_ADAPTER:'rules-only',GEMINI_API_KEY:'local-wire-fixture',
      GOOGLE_GEMINI_BASE_URL:'http://127.0.0.1:'+provider.address().port},
  });
  let hostLog='';for(const stream of [host.stdout,host.stderr])stream.on('data',b=>{hostLog+=b;});
  const stopped=once(host,'exit');
  t.after(async()=>{
    clearInterval(timer);
    for(const socket of sockets.clients) socket.terminate();
    host.kill();await stopped;
    sockets.close();await new Promise(r=>provider.close(r));
    await rm(dir,{recursive:true,force:true});
  });
  const base='http://127.0.0.1:'+port;
  const post=(path,body={},cookie='')=>fetch(base+path,{method:'POST',headers:{cookie,'Content-Type':'application/json','x-show-control':'1'},body:JSON.stringify(body)});
  const state=()=>fetch(base+'/rehearsal/state').then(r=>r.json());
  await eventually(async()=>host.exitCode!==null?assert.fail(hostLog):(await state().catch(()=>null)));
  assert.equal((await post('/rehearsal/reset-photo')).status,200);
  const start=await post('/rehearsal/start',{mode:'genie',seed:empty});
  assert.equal(start.status,200,await start.text());
  await eventually(async()=>((await state()).round?.phase==='playing'));
  const guest=await fetch(base+'/api/crowd/state');
  const cookie=guest.headers.get('set-cookie').split(';')[0];
  const submit=await post('/api/crowd/haunt',{text:'A small cart rolls across the aisle.'},cookie);
  assert.ok(submit.ok,await submit.text());
  let round;
  const sidestep=/one visible sidestep to its left/i;
  try {
    await eventually(async()=>{
      round=(await state()).round;
      return wire.some(({event})=>sidestep.test(event.content?.[0]?.text||''));
    },22_000);
  } catch(error) {
    const entries=await readdir(join(dir,'runs')).catch(()=>[]);
    const run=entries.find(entry=>entry.startsWith('photo-round-'));
    const log=run && JSON.parse(await readFile(join(dir,'runs',run,'session.json'),'utf8'));
    throw Error(JSON.stringify({round,wire:wire.map(({event})=>event.content?.[0]?.text||event.event_type),
      native:log?.events.map(e=>[e.frame,e.action,e.observed,e.reason]),hostLog}));
  }
  const pause=wire.findIndex(({event})=>event.content?.[0]?.text.startsWith('Stop the existing explorer'));
  const placement=wire.findIndex(({event})=>event.content?.[0]?.text.includes('planned next footfall'));
  const reaction=wire.findIndex(({event})=>sidestep.test(event.content?.[0]?.text||''));
  assert.ok(pause>=0 && placement>pause && reaction>placement);
  assert.equal(wire.slice(pause,reaction).some(({event})=>event.action==='key_down'),false);
  assert.ok(visionReads.some((read,i)=>i>0 && read.at-visionReads[i-1].at>=3100));
  assert.ok(visionReads.some(read=>read.placement && read.frames>wire[placement].frame));
  round=(await state()).round;
  assert.equal(round.props[0].inPath,true);
  assert.equal(round.lastMoveApplied.key,'A');
  assert.equal(round.lastMoveApplied.observed,round.props[0].confirmedFrame);
  const firstChanged=visionReads.find(read=>read.placement);
  assert.ok(Math.abs(round.lastMoveApplied.observed-firstChanged.frames)<=2,
    'the first verified picture containing the obstacle can drive the response');
  assert.equal(round.fear,0,'a delivered motion command is not measured movement or fear');
  t.diagnostic('Post-effect frame '+round.lastMoveApplied.observed+' dispatched key A; the SDK WebSocket received the sidestep at native frame '+wire[reaction].frame+
    ' after observation gaps '+visionReads.slice(1).map((read,i)=>((read.at-visionReads[i].at)/1000).toFixed(1)).join(', ')+'s');
  // Keep the fixture feet and obstacle fixed after the wire accepts the step.
  // A checked next picture must produce a blocked result, never a scored dodge.
  const reviewed=await eventually(async()=>{
    const current=(await state()).round;
    return current.props[0].response?.outcome==='still-blocked' && current;
  });
  const result=reviewed.props[0].response;
  assert.equal(reviewed.props[0].observedReaction,undefined);
  assert.equal(reviewed.fear,0);
  const after=visionReads.find(read=>read.informed);
  assert.ok(after && after.imageCount>=3 && !after.leaked,'the Brain receives the actual prior input and visual reference only');
  await eventually(()=>visionReads.some(read=>read.knowsOutcome));
  const stop=wire.slice(reaction+1).find(({event})=>event.content?.[0]?.text.startsWith('Stop the existing explorer'));
  assert.ok(stop && stop.frame>result.checkedFrame && stop.frame-wire[reaction].frame>25);
  assert.ok(result.checkedFrame>=result.appliedFrame+18);
  t.diagnostic('The next picture at '+result.checkedFrame+' still showed the obstruction. The stop reached the wire at '+stop.frame+'.');
  await post('/rehearsal/stop');
  await eventually(async()=>!(await state()).providerClosing);
});
