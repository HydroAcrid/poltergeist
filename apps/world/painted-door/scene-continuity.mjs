import jpeg from 'jpeg-js';

// Average colour over a grid so JPEG noise and a moving flashlight do not
// outweigh the positions of the ceiling, walls, floor and fixed furniture.
function zones(bytes) {
  const {width,height,data} = jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:3});
  const areas = Array.from({length:6},()=>[]);
  const cols=40, rows=24;
  for (let y=1;y<rows-1;y++) for (let x=1;x<cols-1;x++) {
    const rgb=[0,0,0];
    for (const dy of [.2,.5,.8]) for (const dx of [.2,.5,.8]) {
      const i=4*(Math.floor((y+dy)*height/rows)*width+Math.floor((x+dx)*width/cols));
      for (let c=0;c<3;c++) rgb[c]+=data[i+c]/9;
    }
    areas[Math.floor(3*x/cols)+3*Math.floor(2*y/rows)].push(rgb);
  }
  return {areas,aspect:width/height};
}

function compare(a,b) {
  let sumA=0,sumB=0,squareA=0,squareB=0,product=0,colorError=0;
  for (let i=0;i<a.length;i++) {
    const p=a[i],q=b[i];
    const u=(p[0]+2*p[1]+p[2])/4,v=(q[0]+2*q[1]+q[2])/4;
    sumA+=u;sumB+=v;squareA+=u*u;squareB+=v*v;product+=u*v;
    colorError+=(Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2]))/3;
  }
  const n=a.length,meanA=sumA/n,meanB=sumB/n;
  // Stabilized structural similarity of the region's luminance grid.
  const structure=(2*(product/n-meanA*meanB)+58.5)/
    (squareA/n-meanA*meanA+squareB/n-meanB*meanB+58.5);
  return {structure,colorError:colorError/n};
}

export function compareOpening(seed, frames) {
  const previous=zones(seed);
  const samples=frames.map(({bytes,frame})=>{
    const next=zones(bytes);
    const regions=previous.areas.map((area,i)=>compare(area,next.areas[i]));
    const passed=regions.filter(r=>r.structure>=.82 && r.colorError<=16).length;
    return {frame,matchedRegions:passed,consistent:Math.abs(previous.aspect-next.aspect)<.02 && passed>=5 &&
      regions.every(r=>r.structure>=.55 && r.colorError<=35)};
  });
  return {matches:samples.length>0 && samples.every(s=>s.consistent),samples};
}
