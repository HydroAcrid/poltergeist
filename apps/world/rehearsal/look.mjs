// Fractions of the uncropped 16:9 image. The camera sits behind the right shoulder.
export const shoulderFrame = Object.freeze({x:.21, width:.29, height:.70, top:.26, packWidth:.215});

export const audienceView = [
  "Use a raised rear three-quarter tracking shot from behind the explorer’s RIGHT shoulder. Travel parallel to the explorer at walking speed with fixed focal length and a steady offset.",
  "Look diagonally across the action. The route runs from the lower left foreground toward the upper right distance. Keep the explorer near the left fifth, about 29 percent of the image width. The audience can see its backpack and flashlight hand.",
  "Show the next three strides of floor as a continuous open lane to the right of the silhouette. Keep enough space to see an entire approaching object and the explorer in the same shot.",
].join(" ");

// Frame the empty opening once. Live frames always use the provider’s full image.
export function openingCrop(point) {
  const target = {x:.72, y:.38};
  const scale = Math.max(.55, Math.min(1, point.x / target.x, (1-point.x) / (1-target.x),
    point.y / target.y, (1-point.y) / (1-target.y)));
  const bound = n => Math.max(0, Math.min(1-scale,n));
  return {x:bound(point.x - target.x * scale), y:bound(point.y - target.y * scale), scale};
}

// Use the same lighting direction for the room reconstruction and the live world.
export const hallwayLighting = [
  "It is after closing time in the photographed venue. The overhead lights are dim.",
  "Cool blue-green shadows fill the upper walls and corners; isolated warm practical lamps and the robot’s amber flashlight light the path.",
  "Preserve the venue materials, silhouettes and recognizable landmarks. Keep detail in the shadows and enough light at boot height to read an obstacle from across a room.",
].join(" ");

export function dimmingFor(midtones) {
  return Math.min(0.39, Math.max(0.035, (midtones - 45) / 300));
}

export function createHallwayLighting(ctx, width, height) {
  const sample = document.createElement('canvas');
  sample.width = 24;
  sample.height = 14;
  const meter = sample.getContext('2d', { willReadFrequently: true });
  const ceiling = ctx.createLinearGradient(0, 0, 0, height);
  ceiling.addColorStop(0, 'rgba(12,22,43,0.38)');
  ceiling.addColorStop(0.58, 'rgba(12,22,43,0.10)');
  ceiling.addColorStop(1, 'rgba(12,22,43,0)');
  const corners = ctx.createRadialGradient(width*.49, height*.65, height*.25, width*.49, height*.55, width*.66);
  corners.addColorStop(0, 'rgba(8,15,30,0)');
  corners.addColorStop(1, 'rgba(8,15,30,0.36)');
  let strength = 0.22, lastMetered = -Infinity, previousTime = 0;

  function measure() {
    meter.drawImage(ctx.canvas, 0, 0, sample.width, sample.height);
    const pixels = meter.getImageData(0, 0, sample.width, sample.height).data;
    const levels = [];
    for (let i=0; i<pixels.length; i+=4) {
      levels.push(0.2126*pixels[i] + 0.7152*pixels[i+1] + 0.0722*pixels[i+2]);
    }
    levels.sort((a,b)=>a-b);
    return dimmingFor(levels[Math.floor(levels.length*.60)]);
  }
  let target = strength;
  return function grade(amount, now, reset = false) {
    if (amount <= 0) return;
    if (reset || now < lastMetered || now-lastMetered > 650) {
      target = measure();
      if (reset || !Number.isFinite(lastMetered)) strength = target;
      lastMetered = now;
    }
    const dt = Math.max(0, Math.min(0.25, (now-previousTime)/1000));
    previousTime = now;
    strength += (target-strength) * (1-Math.exp(-dt*2));
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = strength*amount;
    ctx.fillStyle = '#345775';
    ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation = 'source-over';
    // Keep the centre aisle readable, with most of the falloff above the floor.
    ctx.globalAlpha = amount*(0.25 + 1.7*strength);
    ctx.fillStyle = ceiling;
    ctx.fillRect(0,0,width,height);
    ctx.fillStyle = corners;
    ctx.fillRect(0,0,width,height);
    ctx.restore();
  };
}
