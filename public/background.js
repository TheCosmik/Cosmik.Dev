const canvas = document.getElementById('space');
const ctx = canvas.getContext('2d');

let width, height, cx, cy;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  cx = width / 2;
  cy = height / 2;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const blobs = [
  { x: 0.14, y: -0.02, r: 0.4, hue: [63, 224, 102], alpha: 0.12, speed: 0.0001, phase: 0 },
  { x: 0.88, y: 1.02, r: 0.44, hue: [63, 224, 102], alpha: 0.09, speed: 0.00009, phase: 2.4 }
];

let mouseX = 0, mouseY = 0;
let smoothX = 0, smoothY = 0;

window.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX - cx) / cx;
  mouseY = (e.clientY - cy) / cy;
});

window.addEventListener('mouseleave', () => {
  mouseX = 0;
  mouseY = 0;
});

let t = 0;

function draw() {
  t += 1;
  smoothX += (mouseX - smoothX) * 0.03;
  smoothY += (mouseY - smoothY) * 0.03;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07090a';
  ctx.fillRect(0, 0, width, height);

  const diag = Math.hypot(width, height);

  for (const b of blobs) {
    const drift = t * b.speed + b.phase;
    const px = width * b.x + Math.cos(drift) * width * 0.05 + smoothX * 16;
    const py = height * b.y + Math.sin(drift * 0.8) * height * 0.05 + smoothY * 16;
    const radius = diag * b.r;

    const glow = ctx.createRadialGradient(px, py, 0, px, py, radius);
    glow.addColorStop(0, `rgba(${b.hue[0]},${b.hue[1]},${b.hue[2]},${b.alpha})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}
draw();
