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

const STAR_COUNT = 420;
const maxRadius = () => Math.hypot(cx, cy) * 1.15;

const stars = Array.from({ length: STAR_COUNT }, () => {
  const depth = Math.random();
  return {
    angle: Math.random() * Math.PI * 2,
    radius: Math.random() * maxRadius(),
    depth: 0.15 + depth * 0.85,
    size: 0.4 + depth * 1.6,
    twinkleSpeed: 0.5 + Math.random() * 1.5,
    twinklePhase: Math.random() * Math.PI * 2
  };
});

const planets = [
  { angle: 2.4, radius: 0.55, depth: 0.2, size: 220, hue: [90, 160, 255], drift: 0.0004 },
  { angle: 5.1, radius: 0.75, depth: 0.35, size: 130, hue: [200, 130, 255], drift: -0.0007 }
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
  smoothX += (mouseX - smoothX) * 0.04;
  smoothY += (mouseY - smoothY) * 0.04;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
  bg.addColorStop(0, '#0a1024');
  bg.addColorStop(0.55, '#050813');
  bg.addColorStop(1, '#020208');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (const p of planets) {
    p.angle += p.drift;
    const parallax = 40 * p.depth;
    const px = cx + Math.cos(p.angle) * width * p.radius * 0.5 + smoothX * parallax;
    const py = cy + Math.sin(p.angle) * height * p.radius * 0.5 + smoothY * parallax;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, p.size);
    glow.addColorStop(0, `rgba(${p.hue[0]},${p.hue[1]},${p.hue[2]},0.18)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const s of stars) {
    const rotSpeed = 0.00006 * (1.4 - s.depth);
    s.angle += rotSpeed;

    const parallaxStrength = 60 * s.depth;
    const x = cx + Math.cos(s.angle) * s.radius + smoothX * parallaxStrength;
    const y = cy + Math.sin(s.angle) * s.radius + smoothY * parallaxStrength;

    if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;

    const twinkle = 0.55 + 0.45 * Math.sin(t * 0.02 * s.twinkleSpeed + s.twinklePhase);
    const alpha = 0.35 + 0.65 * twinkle * s.depth;

    ctx.beginPath();
    ctx.arc(x, y, s.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210, 230, 255, ${alpha})`;
    ctx.fill();
  }

  requestAnimationFrame(draw);
}
draw();
