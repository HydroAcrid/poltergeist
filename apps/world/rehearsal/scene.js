import { createHallwayLighting, openingCrop, shoulderFrame } from './look.mjs';
import { hallwayBlackout, createGhostVeil, createMotionGate } from './veil.mjs';
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};
const image = async (src) => {
  const i = new Image();
  i.src = src;
  await i.decode();
  return i;
};

export async function createScene(canvas) {
  const W = 1280, H = 720;
  const screen = canvas.getContext('2d');
  let ctx = screen;
  const seedCanvas = document.createElement('canvas');
  seedCanvas.width = W;
  seedCanvas.height = H;
  const seedContext = seedCanvas.getContext('2d');
  const seedGrade = createHallwayLighting(seedContext, W, H);
  const veil = createGhostVeil(W,H), motion = createMotionGate();
  let presentingId, fullyCovered = false, revealedAt = null, hasShownWorld = false;
  const grade = createHallwayLighting(ctx, W, H);
  const [robot, peel] = await Promise.all(['/explorer.webp', '/peel.webp'].map(image));
  let preparedHall=null, cameraDepth=0, cameraPan=0, cameraZoom=1, tickTime=0;
  function followLive(img, _round, now = Date.now()) {
    if (!img.naturalWidth || !img.naturalHeight) return false;
    ctx.drawImage(img, 0, 0, W, H);
    grade(1, now);
    return true;
  }
  let source = await image('/rehearsal/source'),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function aislePoint(img, expected) {
    const sample = document.createElement('canvas');
    sample.width = 112;
    sample.height = Math.round(112 * img.height / img.width);
    const w = sample.width, h = sample.height;
    const g = sample.getContext('2d', {willReadFrequently:true});
    g.drawImage(img, 0, 0, w, h);
    const rgb = g.getImageData(0, 0, w, h).data;
    const lum = (x, y) => { const i = 4*(y*w+x); return (rgb[i]+2*rgb[i+1]+rgb[i+2])/4; };
    const edges = [];
    for(let y=2; y<h-2; y+=2) for(let x=2; x<w-2; x+=2) {
      const gx=lum(x+1,y)-lum(x-1,y), gy=lum(x,y+1)-lum(x,y-1);
      const weight=Math.hypot(gx,gy);
      if(weight>21 && Math.min(Math.abs(gx),Math.abs(gy))>.15*weight)
        edges.push({x,y,nx:gx/weight,ny:gy/weight,weight:Math.min(75,weight)});
    }
    // Diagonal floorboards and ceiling ducts vote for a common point in the image.
    let best=-1, point=expected;
    for(let dy=-3; dy<=3; dy++) for(let dx=-4; dx<=4; dx++) {
      const px=clamp(expected.x+dx*.025), py=clamp(expected.y+dy*.025);
      let votes=0;
      for(const e of edges){
        const ax=px*w-e.x, ay=py*h-e.y;
        if(Math.hypot(ax,ay)<w*.15)continue;
        const distance=Math.abs(ax*e.nx+ay*e.ny);
        if(distance<3)votes+=e.weight*(1-distance/3);
      }
      votes/=1+.009*(dx*dx+dy*dy);
      if(votes>best){best=votes;point={x:px,y:py};}
    }
    return best>0 ? point : expected;
  }
  let sourceAisle=aislePoint(source,{x:.52,y:.54});
  let roomAisle={x:.74,y:.40};
  function openingPhoto(progress) {
    const fit=Math.min(W/source.width,H/source.height);
    const fill=Math.max(W/source.width,H/source.height);
    const startWidth=source.width*fit, startHeight=source.height*fit;
    const x0=(W-startWidth)/2+sourceAisle.x*startWidth;
    const y0=(H-startHeight)/2+sourceAisle.y*startHeight;
    const finalZoom=Math.max(1.15,roomAisle.x/Math.max(.23,sourceAisle.x));
    const scale=fit*Math.pow(fill*finalZoom/fit,progress);
    const width=source.width*scale, height=source.height*scale;
    const x=x0+(roomAisle.x*W-x0)*progress-sourceAisle.x*width;
    const y=y0+(roomAisle.y*H-y0)*progress-sourceAisle.y*height;
    // Until a dimension fills the screen retain its matte. Afterwards keep the
    // vanishing point aligned with the room without exposing an empty border.
    const align=(offset,span,screen)=>span<screen?(screen-span)/2:Math.min(0,Math.max(screen-span,offset));
    ctx.drawImage(source,align(x,width,W),align(y,height,H),width,height);
  }
  function presentLive(img, round, now) {
    if (presentingId !== round.id) {
      presentingId=round.id;fullyCovered=false;revealedAt=null;hasShownWorld=false;
      motion.reset();
    }
    const elapsed=Math.max(0,now-round.openedAt), still=reduced.matches;
    if (round.phase === 'ended') {
      if (!hasShownWorld)veil(screen,'hold',1,0,true);
      return hasShownWorld;
    }
    const coverFor=still?420:1550;
    const drawPhoto=()=>{
      screen.fillStyle='#0b0e0d';screen.fillRect(0,0,W,H);
      openingPhoto(0);
    };
    if(elapsed<1250+coverFor) {
      drawPhoto();
      if(elapsed>1250)veil(screen,'cover',clamp((elapsed-1250)/coverFor),elapsed,still);
      return false;
    }
    if(!fullyCovered){
      veil(screen,'hold',1,elapsed,still);fullyCovered=true;
      return false;
    }
    if(round.phase==='playing' && img?.naturalWidth && revealedAt==null &&
       motion.ready(img,round.trackedBody,now))revealedAt=now;
    if(revealedAt==null){
      veil(screen,'hold',1,elapsed,still);
      return false;
    }
    if(!img?.naturalWidth)return hasShownWorld;
    followLive(img,round,now);
    const progress=clamp((now-revealedAt)/(still?420:1450));
    veil(screen,'reveal',progress,elapsed,still);
    hasShownWorld ||= progress>0;
    return hasShownWorld;
  }
  function cover(i, zoom = 1, cx = 0.5, cy = 0.5) {
    const scale = Math.max(W / i.width, H / i.height) * zoom,
      w = i.width * scale,
      h = i.height * scale;
    ctx.drawImage(i, -(w - W) * cx, -(h - H) * cy, w, h);
  }
  function room(custom, amount = 1) {
    ctx.save();
    ctx.globalAlpha = amount;
    const plate=preparedHall || source;
    const cx=cameraZoom>1?clamp(.52+cameraPan):.52;
    cover(plate,cameraZoom,cx,plate.height>plate.width?.58:.60);
    ctx.restore();
  }
  function floor(d, l, custom) {
    return {
      x: (.31 + .35*d + .12*l)*W,
      y: (1.03 - .50*d + .04*l)*H,
    };
  }
  function adventurer(
    d,
    l,
    custom,
    opacity = 1,
    walk = 0,
    flinch = 0,
    entry = 0,
  ) {
    // The opaque sprite is 377px wide inside its original 548px sheet; position
    // the visible silhouette while keeping the route to its right open.
    const scale = W*shoulderFrame.width/377;
    const w=robot.width*scale, h=robot.height*scale;
    const p={x:(shoulderFrame.x+.045*l)*W,y:shoulderFrame.top*H+(robot.height-33)*scale};
    p.x -= entry * .055 * W; p.y += entry*.012*H;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(p.x,p.y); ctx.scale(1+.025*entry,1+.025*entry);
    ctx.fillStyle = '#15140d58';
    ctx.beginPath();
    ctx.ellipse(0, -2, w * 0.32, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(flinch * -0.11);
    const ax = w * 0.33,
      ay = -h * 0.67;
    const glow = ctx.createRadialGradient(
      ax,
      ay,
      0,
      ax + h * 0.55,
      ay - h * 0.06,
      h * 0.8,
    );
    glow.addColorStop(0, 'rgba(255,206,120,.34)');
    glow.addColorStop(1, 'rgba(255,198,110,0)');
    ctx.save();
    ctx.filter = 'blur(7px)';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + h * 1.2, ay - h * 0.3);
    ctx.lineTo(ax + h * 1.2, ay + h * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.drawImage(robot, -w / 2, -h + walk * h * 0.009, w, h);
    ctx.restore();
  }
  function prop(item, custom, now) {
    const p = floor(item.depth, item.lane, custom),
      s = 1.18 - item.depth * .14,
      age = now - item.placedAt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(age / 320);
    if (item.kind === 'peel') ctx.drawImage(peel, -51, -40, 102, 40);
    else if (item.kind === 'lights') {
      if (age < 4300) {
        ctx.resetTransform();
        ctx.fillStyle = '#151b2e68';
        ctx.fillRect(0, 0, W, H);
      }
    } else if (item.kind === 'fog') {
      const g = ctx.createRadialGradient(0, -22, 2, 0, -20, 170);
      g.addColorStop(0, '#dae9d3bb');
      g.addColorStop(1, '#d5e2cf00');
      ctx.fillStyle = g;
      ctx.fillRect(-170, -190, 340, 340);
    } else if (item.kind === 'papers') {
      ctx.fillStyle = '#eee4c6';
      for (let i = 0; i < 7; i++) {
        ctx.save();
        ctx.translate(-87 + i * 25, -18 - (i % 3) * 24);
        ctx.rotate(i * 0.68);
        ctx.fillRect(-13, -8, 26, 16);
        ctx.restore();
      }
    } else if (item.kind === 'chair') {
      ctx.fillStyle = '#e5ae5e';
      ctx.strokeStyle = '#49301a';
      ctx.lineWidth = 3;
      ctx.rotate(-0.19);
      for (const a of [
        [-24, -63, 10, 62],
        [20, -64, 10, 64],
        [-24, -67, 54, 13],
        [-23, -105, 10, 47],
        [20, -105, 9, 47],
        [-24, -105, 54, 18],
      ]) {
        ctx.fillRect(...a);
        ctx.strokeRect(...a);
      }
    } else if (item.kind === 'marbles' || item.kind === 'balloons') {
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.fillStyle = ['#b5d8ca', '#ffbf91', '#d1abe5'][i % 3];
        ctx.arc(
          -30 + i * 14,
          -8 - (i % 2) * 8 - (item.kind === 'balloons' ? 45 : 0),
          item.kind === 'balloons' ? 19 : 6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (item.kind === 'bucket') {
      ctx.fillStyle = '#96bec2';
      ctx.fillRect(-20, -40, 40, 37);
      ctx.strokeStyle = '#d4edea';
      ctx.strokeRect(-20, -42, 40, 5);
    } else {
      ctx.fillStyle = '#425b53';
      ctx.fillRect(-20, -85, 40, 84);
      ctx.fillStyle = '#fff7c9';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('EXIT', -13, -65);
    }
    ctx.restore();
  }
  function render(state, now, forceGame = false) {
    const r = state.round,
      custom = state.custom;
    const elapsed = r ? (now-r.openedAt)/1000 : 0;
    const opening = r?.phase==='opening' && !forceGame;
    const depth=r?.depth||0, dt=Math.max(0,Math.min(.08,(now-tickTime)/1000));tickTime=now;
    const blendStep=1-Math.exp(-dt*4.5);
    cameraDepth=forceGame||!r||r.phase==='opening'?0:cameraDepth+(depth-cameraDepth)*blendStep;
    cameraZoom=1+.22*smooth(cameraDepth);
    const targetPan=.14*smooth(cameraDepth);
    cameraPan=forceGame||!r||r.phase==='opening'?0:cameraPan+(targetPan-cameraPan)*blendStep;
    const showPhoto=!forceGame && (!r || (opening && elapsed < 5.4));
    if (showPhoto) {
      ctx.fillStyle='#0b0e0d';
      ctx.fillRect(0,0,W,H);
      const push=reduced.matches ? 0 : smooth((elapsed-1.15)/3.85);
      const blend=smooth((elapsed-(reduced.matches ? 4.8 : 3.85))/(reduced.matches ? .6 : 1.55));
      openingPhoto(push);
      if(blend)room(custom,blend);
    } else {
      room(custom);
    }
    const entry=forceGame || (!opening && r) ? 1 : smooth((elapsed-5.15)/1.6);
    if(!entry)return;
    const props = r?.live ? [] : r?.props || [];
    for (const item of props.filter((i) => i.depth >= (r?.depth || 0)))
      prop(item, custom, now);
    const since = now - (r?.lastReaction?.at || 0);
    const flinch =
      !reduced.matches && r?.lastReaction?.flinch && since < 1050
        ? Math.sin((Math.PI * since) / 1050)
        : 0;
    adventurer(
      r?.depth || 0,
      r?.lane || 0,
      custom,
      smooth(entry/.53),
      (r?.phase === 'playing' || (opening && entry<1)) && !reduced.matches ? Math.sin(now / 125) : 0,
      flinch,
      reduced.matches ? 0 : 1 - entry,
    );
    for (const item of props.filter((i) => i.depth < (r?.depth || 0)))
      prop(item, custom, now);
  }
  function paint(state, now, forceGame = false) {
    render(state, now, forceGame);
    const round = state.round;
    const amount = forceGame ? 1 : !round ? 0 : round.phase === 'opening'
      ? smooth(((now-round.openedAt)/1000-1.15)/3.85) : 1;
    grade(amount, now, forceGame);
  }
  return {
    paint,drawLive:followLive,presentLive,
    async setPlate(key, aisle) {
      if (!key) { preparedHall=null; return; }
      const plate=await image('/rehearsal/plate?key='+encodeURIComponent(key));
      const point=aisle || aislePoint(plate, {x:.55,y:.48});
      const crop=openingCrop(point);
      const framed=document.createElement('canvas');
      framed.width=W; framed.height=H;
      framed.getContext('2d').drawImage(plate, crop.x*plate.width, crop.y*plate.height,
        crop.scale*plate.width, crop.scale*plate.height, 0,0,W,H);
      preparedHall=framed;
      roomAisle={x:(point.x-crop.x)/crop.scale,y:(point.y-crop.y)/crop.scale};
    },
    async setPhoto(rev) {
      source = await image('/rehearsal/source?v=' + rev);
      sourceAisle=aislePoint(source,{x:.52,y:.54});
    },
    seed(state) {
      // Build the provider seed entirely offscreen. The host shares the same
      // projector surface and must never briefly expose the composited sprite.
      ctx=seedContext;
      try {
        render({ ...state, round: null }, Date.now(), true);
        seedGrade(1,0,true);
      } finally { ctx=screen; }
      const small = document.createElement('canvas');
      small.width = 960;
      small.height = 540;
      small.getContext('2d').drawImage(seedCanvas, 0, 0, 960, 540);
      for (const quality of [0.68, 0.55, 0.42, 0.3, 0.2]) {
        const encoded = small.toDataURL('image/jpeg', quality).split(',')[1];
        if (encoded.length <= 64000) return encoded;
      }
      throw Error('The camera image is too large to open.');
    },
  };
}
