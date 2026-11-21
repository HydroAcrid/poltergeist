// Keep first writes prompt and cap stale frames independently for each consumer.
export function frameSink(write, maxPending=1) {
  let busy=false,closed=false;
  const pending=[];
  function flush() {
    if (closed || busy || !pending.length) return;
    const next=pending.shift();
    busy=true;
    write(next,error=>{
      busy=false;
      if (error) { closed=true; pending.length=0; }
      else flush();
    });
  }
  return {
    offer(frame) {
      if (closed) return;
      if (pending.length===maxPending) pending.shift();
      pending.push(frame);
      flush();
    },
    close() { closed=true;pending.length=0; },
  };
}

export function jpegPart(jpeg, frameNumber) {
  const header=Buffer.from('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '+jpeg.length+
    '\r\nX-Frame-Number: '+frameNumber+'\r\n\r\n');
  return Buffer.concat([header,jpeg,Buffer.from('\r\n')]);
}

// The provider timestamps a 24 fps sequence even when a delivery contains a burst.
// Delay the projector briefly; camera tracking and Brain retain the original input.
export function createPlayout(emit, {now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}) {
  const period=1000/24, lead=5*period;
  let timer, origin=0, first=0, last=0;
  const pending=[];
  function reset() {
    if (timer!==undefined) cancel(timer);
    timer=undefined;first=last=0;pending.length=0;
  }
  function arm() {
    if (timer!==undefined || !pending.length) return;
    timer=schedule(play,Math.max(0,Math.ceil(pending[0].due-now())));
  }
  function play() {
    timer=undefined;
    const time=now();
    let latest;
    while (pending.length && pending[0].due<=time) latest=pending.shift();
    if (latest) emit(latest.frame);
    arm();
  }
  return {
    push(frame,number) {
      if (!Number.isSafeInteger(number)||number<=last) return;
      const time=now();
      const due=origin+(number-first)*period;
      if (!first || due<time-period || due>time+lead*2) {
        // A long stall or burst starts a fresh window, rather than replaying old motion.
        reset();
        first=last=number;origin=time+lead;
        emit(frame); // A joining projector receives an initial picture immediately.
        return;
      }
      last=number;
      pending.push({due,frame});
      arm();
    },
    reset,
  };
}
