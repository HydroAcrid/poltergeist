// Measure displacement in native frames. All corrections go to Genie's camera controls.
import jpeg from "jpeg-js";

const width = 112,
  height = 64;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function sampleFrame(bytes, number) {
  const src = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 3 });
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pos =
        4 *
        (Math.floor(((y + 0.5) * src.height) / height) * src.width +
          Math.floor(((x + 0.5) * src.width) / width));
      const i = 3 * (y * width + x);
      pixels[i] = src.data[pos];
      pixels[i + 1] = src.data[pos + 1];
      pixels[i + 2] = src.data[pos + 2];
    }
  return { number, pixels };
}
// Compare the coat/backpack texture in consecutive frames, keeping both color and edges.
function locate(previous, current, anchor) {
  const x = Math.round(anchor.x * width),
    y = Math.round(anchor.y * height);
  const hy = clamp(Math.round(anchor.h * height * 0.18), 2, 7),
    hx = clamp(Math.round(hy * 0.74), 2, 5);
  if (x < hx + 1 || x > width - hx - 2 || y < hy + 1 || y > height - hy - 2)
    return { ...anchor, known: false };
  let best = Infinity,
    bx = x,
    by = y;
  for (
    let yy = Math.max(hy + 1, y - 6);
    yy <= Math.min(height - hy - 2, y + 6);
    yy++
  ) {
    for (
      let xx = Math.max(hx + 1, x - 11);
      xx <= Math.min(width - hx - 2, x + 11);
      xx++
    ) {
      let cost = 0,
        count = 0;
      for (let oy = -hy; oy <= hy; oy += 2)
        for (let ox = -hx; ox <= hx; ox += 2) {
          let old = 3 * ((y + oy) * width + x + ox),
            next = 3 * ((yy + oy) * width + xx + ox);
          for (let c = 0; c < 3; c++) {
            cost += Math.abs(
              previous.pixels[old + c] - current.pixels[next + c],
            );
            count++;
          }
        }
      cost = cost / count + 0.25 * Math.abs(x - xx) + 0.3 * Math.abs(y - yy);
      if (cost < best) {
        best = cost;
        bx = xx;
        by = yy;
      }
    }
  }
  const seconds = Math.max(1/24,(current.number-previous.number)/24);
  const mix = 1-Math.exp(-seconds/.38);
  const vx = (1-mix)*anchor.vx + mix*clamp((bx/width-anchor.x)/seconds,-.6,.6);
  const dy=by/height-anchor.y;
  return {...anchor,x:bx/width,y:by/height,top:anchor.top+dy,bottom:anchor.bottom+dy,vx,known:anchor.known && best<42};
}

// Position and size are fractions of the entire unmodified native image.
// Left-third composition leaves the diagonal aisle open on the flashlight side.
export const shoulderFrame = {x:.265, height:.385};
export function mustStopTravel(subject) {
  return !subject.known || subject.lost || !subject.grounded || subject.x<.055 || subject.x>.94;
}
// Release a live key immediately even when vision has not yet explicitly called the robot lost.
export async function holdIfUntracked(subject,releaseCamera,stopActor) {
  if(!mustStopTravel(subject)) return false;
  await Promise.all([releaseCamera(),stopActor()]);
  return true;
}
export function cameraStep(subject) {
  if (!subject.known || subject.lost || !subject.grounded) return null;
  const {x,h,vx,vh,top,bottom} = subject;
  if (top<.045 && bottom<.93) return {key:'arrow_up',ms:70,reason:'headroom'};
  if (bottom>.95 && top>.10) return {key:'arrow_down',ms:70,reason:'footroom'};
  const error=x-shoulderFrame.x;
  const near=h>shoulderFrame.height*1.34 || (h>.45 && vh>.055);
  const moving=Math.abs(vx)>.021;
  // When the robot is already moving back toward its mark, let it settle.
  if(moving && error*vx<0 && Math.abs(error)>.025) return null;
  if(!near && moving){
    const forecast=error+.42*vx;
    if(Math.abs(forecast)>.037 && Math.sign(forecast)===Math.sign(vx)){
      // Shrinking while moving down the diagonal asks for a little more lateral
      // pace. It never substitutes a forward/backward dolly for missing depth.
      const rangePace=clamp(-vh/.16,-.28,.38);
      const ms=clamp(Math.round((52+205*Math.abs(forecast)+210*Math.abs(vx))*(1+rangePace)),60,185);
      return {key:forecast>0?'key_d':'key_a',ms,reason:'parallel travel'};
    }
  }
  if(Math.abs(error)>.135 && (!moving || near))
    return {key:error>0?'arrow_right':'arrow_left',ms:clamp(Math.round(45+125*Math.abs(error)),55,105),reason:'small pan'};
  return null;
}

export function createNativeFollow() {
  const history=[];
  const neutral={x:.22,y:.65,h:shoulderFrame.height,vx:0,vh:0,top:.44,bottom:.82,known:false};
  let anchor={...neutral}, lastGrounding=-1, lastBox=null, lastStaticCorrection=-1;
  let nextCamera=0, lost=true;
  function push(bytes,number){
    const frame=sampleFrame(bytes,number),prev=history.at(-1);
    if(prev && number<=prev.number)return;
    if(number-lastGrounding>24*16)anchor.known=false;
    if(prev && anchor.known)anchor=locate(prev,frame,anchor);
    history.push(frame);
    // Keep more than ER2's request timeout to align each delayed measurement
    // with its source frame before bringing the body forward to the current one.
    while(history.length>1 && history[0].number<number-24*16)history.shift();
  }
  function observe(scene,number){
    if(number<=lastGrounding)return;
    if(!history.length || number<history[0].number || number>history.at(-1).number+4)return;
    const match=history.findIndex(f=>f.number>=number);
    const index=match<0?history.length-1:match;
    lastGrounding=number;
    if(!scene.visible){lost=true;anchor.known=false;anchor.vx=0;return;}
    const b=scene.bodyBox;
    const valid=Array.isArray(b) && b.length===4 && b.every(v=>Number.isFinite(v)&&v>=0&&v<=1000) && b[0]<b[2] && b[1]<b[3];
    const footX=(scene.feet.left[1]+scene.feet.right[1])/2000;
    const footY=(scene.feet.left[0]+scene.feet.right[0])/2000;
    const h=valid?(b[2]-b[0])/1000:anchor.h;
    const x=valid?(b[1]+b[3])/2000:footX;
    const dt=lastBox?Math.max(1/24,(number-lastBox.number)/24):1;
    const vh=valid&&lastBox?clamp((h-lastBox.h)/dt,-.3,.3):0;
    const vx=lastBox?clamp((x-lastBox.x)/dt,-.6,.6):0;
    if(valid)lastBox={number,h,x};
    lost=false;
    anchor={x,y:valid?(b[0]*.45+b[2]*.55)/1000:clamp(footY-h*.48,.04,.96),h,
      top:valid?b[0]/1000:clamp(footY-h,0,1),bottom:valid?b[2]/1000:footY,
      vx,vh,known:true};
    for(let i=index+1;i<history.length&&anchor.known;i++)anchor=locate(history[i-1],history[i],anchor);
  }
  function status(){return {...anchor,lost,grounded:lastGrounding>=0};}
  function correction(now,allowCamera=true){
    if(!allowCamera || now<nextCamera)return null;
    const step=cameraStep(status());
    if(!step)return null;
    const translation=step.key==='key_d'||step.key==='key_a';
    if(!translation && lastStaticCorrection===lastGrounding)return null;
    if(!translation)lastStaticCorrection=lastGrounding;
    nextCamera=now+step.ms+(translation?300:520);
    return {...step,x:anchor.x,height:anchor.h,velocity:anchor.vx};
  }
  function permits(key){
    if(mustStopTravel(status()))return false;
    return ['W','A','S','D','ArrowLeft','ArrowRight'].includes(key);
  }
  return {push,observe,correction,permits,status};
}

export function characterInstruction(command) {
  const dir={A:'left',D:'right',ArrowLeft:'left',ArrowRight:'right'}[command.key];
  if(command.key==='W')return 'The robot takes the next two small walking strides toward the signed exit along the visible floor, then waits for its next decision. Its backpack and flashlight stay in view.';
  if(command.key==='S')return 'The robot takes one small step back along its own approach, then steadies its feet.';
  if(command.key==='A'||command.key==='D')return command.reaction==='avoid'
    ? `The robot takes exactly one visible sidestep to its ${dir} around the obstruction, keeping both boots clear. It plants its foot and points its flashlight along the open route.`
    : `The robot takes one small sidestep to its ${dir}, then plants both boots on the floor.`;
  if(dir)return `The robot turns its shoulders and flashlight slightly to its ${dir} to inspect the next piece of walkable floor. Its feet stay planted.`;
  return null;
}

export function reactionInstruction(command) {
  if(command.reaction==='startle') return "The same small robot jolts at the surprise in front of its boots, makes one short hop back and steadies its flashlight on the obstacle. Both boots land nearby.";
  if(command.reaction==='notice' && ['left','right'].includes(command.toward))
    return `The robot keeps both boots planted and glances to its ${command.toward}, turning just its head and flashlight briefly toward the new movement. Its body stays in place.`;
  return null;
}
