// Rear view. Feet and shadow share a floor anchor through the stumble.
function drawRobot(ctx, { x, y }, depth, gait, stumble) {
  const scale = 1.1 - 0.69 * depth;
  ctx.save();
  ctx.translate(x * 1280, y * 720);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#2b201a55';
  ctx.beginPath();
  ctx.ellipse(0, 0, 35, 7, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.translate(stumble * 5, 3 * stumble);
  ctx.rotate(stumble * 0.72);
  ctx.translate(0, stumble * 16);
  function plate(x, y, w, h, r, fill, stroke = '#293237') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  function limb(x1, y1, x2, y2, width, color) {
    ctx.lineCap = 'round';
    ctx.lineWidth = width + 4;
    ctx.strokeStyle = '#303739';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  for (const side of [-1, 1]) {
    const step = side * gait;
    const footX = side * (14 + stumble * 17),
      footY = -3 - Math.max(0, step) * 11 - (side === 1 ? stumble * 24 : 0);
    limb(side * 13, -36, footX, footY - 4, 12, '#929e9b');
    plate(footX - 10, footY - 6, 21, 10, 4, '#556365');
  }
  ctx.translate(0, -Math.abs(gait) * 2.2);
  for (const side of [-1, 1]) {
    const elbow = side * (33 + stumble * 9),
      hand = side * (31 + stumble * 24);
    const handY = -37 + side * gait * 7 - stumble * 35;
    limb(side * 23, -72, elbow, -54 - stumble * 11, 10, '#c8d2cd');
    limb(elbow, -54 - stumble * 11, hand, handY, 8, '#8a9b9a');
    plate(hand - 5, handY - 4, 11, 10, 4, '#516164');
  }
  plate(-23, -83, 46, 52, 12, '#c5cfc7');
  plate(-16, -73, 32, 31, 7, '#de793e');
  plate(-12, -68, 24, 5, 2, '#f1b679', '#ad6739');
  ctx.fillStyle = '#804c35';
  ctx.fillRect(-10, -52, 20, 2);
  limb(12, -104, 17, -120, 3, '#859693');
  ctx.beginPath();
  ctx.arc(18, -122, 4, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffbb79';
  ctx.fill();
  plate(-28, -110, 56, 34, 12, '#d2dcd5');
  plate(-25, -91, 50, 7, 3, '#758783');
  ctx.fillStyle = '#b0eaca';
  ctx.fillRect(-6, -89, 12, 2);
  ctx.restore();
}
