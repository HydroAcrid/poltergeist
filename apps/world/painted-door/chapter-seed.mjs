import jpeg from 'jpeg-js';
import { validCheckpoint } from '../rehearsal/chapters.mjs';

// Preserve the exact observed camera view. Downsample only as needed to fit
// the generation input, without cropping the explorer or changing perspective.
export function chapterSeed(input) {
  const source=Buffer.from(input,'base64');
  try {
    const decoded=jpeg.decode(source,{useTArray:true,maxResolutionInMP:3});
    if (Math.abs(decoded.width/decoded.height-16/9)>.035) return null;
    if (validCheckpoint(source)) return input;
    for(const maxWidth of [960,720,480]) {
      const width=Math.min(decoded.width,maxWidth),height=Math.round(width*decoded.height/decoded.width);
      const data=Buffer.alloc(width*height*4);
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const from=4*(Math.floor(y*decoded.height/height)*decoded.width+Math.floor(x*decoded.width/width));
        const to=4*(y*width+x);
        for(let channel=0;channel<4;channel++) data[to+channel]=decoded.data[from+channel];
      }
      const result=jpeg.encode({width,height,data},65).data;
      if(validCheckpoint(result)) return result.toString('base64');
    }
  } catch { /* An incomplete native image cannot seed the next provider. */ }
  return null;
}
