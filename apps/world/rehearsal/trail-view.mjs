// Rotate observed floor coordinates into robot-forward coordinates for Brain.
// [y,x] is perspective image space. The heading comes from the latest camera frame.
function heading(scene) {
  const origin=scene.feet.left.map((n,i)=>(n+scene.feet.right[i])/2);
  const ahead=scene.ahead || scene.goal;
  let dy=ahead?ahead[0]-origin[0]:-80,dx=ahead?ahead[1]-origin[1]:200;
  if(Math.hypot(dy,dx)<20){dy=-80;dx=200;}
  const distance=Math.hypot(dy,dx);
  return {origin,dy:dy/distance,dx:dx/distance};
}
export function fromTrailView(scene) {
  const {origin,dy,dx}=heading(scene);
  const clamp=n=>Math.round(Math.max(0,Math.min(1000,n)));
  function project([y,x]){
    const row=y-origin[0],col=x-origin[1];
    return [clamp(800-(row*dy+col*dx)),clamp(500+row*dx-col*dy)];
  }
  return {...scene,feet:{left:project(scene.feet.left),right:project(scene.feet.right)},
    goal:scene.goal?project(scene.goal):scene.rightFloorVisible?[350,500]:undefined,
    obstacles:scene.obstacles.map(o=>({point:project(o.point)}))};
}
// Genie trains movement and camera orientation as different native controls.
export function trailInput(choice) {
  const key = choice.action.key;
  const rationale = {
    W: 'Walking toward the exit',
    A: 'Stepping around an obstacle',
    D: 'Stepping around an obstacle',
    ArrowLeft: 'Looking left along the route',
    ArrowRight: 'Looking right along the route',
  }[key];
  return rationale ? { ...choice, rationale } : choice;
}
