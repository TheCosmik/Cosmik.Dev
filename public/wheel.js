// "Spin for tonight's pick": a wheel with a poster on every slice that picks a
// random title from the unwatched watchlist. Pairs with watching.js, which
// exposes window.watchApi, and wheel-math.js for the spin maths.
(function () {
  const M = window.WheelMath;
  const api = () => window.watchApi;
  const openBtn = document.getElementById('wheel-open');
  if (!openBtn || !M) return;

  const modal = document.getElementById('wheel-modal');
  const closeBtn = document.getElementById('wheel-close');
  const kindsEl = document.getElementById('wheel-kinds');
  const noteEl = document.getElementById('wheel-note');
  const stageEl = document.getElementById('wheel-stage');
  const canvas = document.getElementById('wheel-canvas');
  const spinBtn = document.getElementById('wheel-spin');
  const resultEl = document.getElementById('wheel-result');
  const resultArt = document.getElementById('wheel-result-art');
  const resultTitle = document.getElementById('wheel-result-title');
  const resultMeta = document.getElementById('wheel-result-meta');
  const watchedBtn = document.getElementById('wheel-mark-watched');
  const ctx = canvas.getContext('2d');

  const MAX_SLICES = 12;
  const MAX_CANVAS_CSS = 440;
  const SPIN_MS = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1200 : 5600;
  const KINDS = [['all', 'All'], ['movie', 'Movies'], ['show', 'Shows']];

  let kind = 'all';
  let pool = [];
  let slices = [];
  let sliceImages = [];
  let artCanvas = null;
  let dpr = 1;
  let theta = 0;
  let kick = 0;
  let spinning = false;
  let spinToken = 0;
  let buildToken = 0;
  let hasSpun = false;
  let current = null;

  /* ---------- randomness (crypto, not Math.random) ---------- */

  function randomInt(n) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }

  function randomUnit() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }

  function sample(list, k) {
    const a = list.slice();
    for (let i = 0; i < k; i++) {
      const j = i + randomInt(a.length - i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  }

  /* ---------- poster loading ---------- */

  const imageCache = new Map();
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        setTimeout(() => resolve(null), 7000);
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  /* ---------- drawing ---------- */

  function geometry() {
    const S = canvas.width;
    return { S, c: S / 2, R: S / 2 - 12 * dpr, step: M.TAU / Math.max(1, slices.length) };
  }

  function wedge(g, from, to) {
    ctx.beginPath();
    ctx.moveTo(g.c, g.c);
    ctx.arc(g.c, g.c, g.R, from, to);
    ctx.closePath();
  }

  function fitText(c2, text, maxWidth) {
    if (c2.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && c2.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  // The wheel face never changes while spinning, so it is painted once and the
  // spin just rotates that picture.
  function renderArt() {
    const g = geometry();
    artCanvas = document.createElement('canvas');
    artCanvas.width = artCanvas.height = g.S;
    const a = artCanvas.getContext('2d');
    const { c, R, step } = g;

    slices.forEach((item, i) => {
      const from = i * step;
      const to = from + step;
      const mid = from + step / 2;
      a.save();
      a.beginPath();
      a.moveTo(c, c);
      a.arc(c, c, R, from, to);
      a.closePath();
      a.clip();
      a.fillStyle = i % 2 ? '#171d17' : '#121712';
      a.fillRect(0, 0, g.S, g.S);

      const img = sliceImages[i];
      a.translate(c, c);
      a.rotate(mid + Math.PI / 2); // poster upright, top edge toward the rim
      if (img) {
        const rimWidth = slices.length === 1 ? R * 1.6 : 2 * R * Math.sin(Math.min(step, Math.PI) / 2);
        const cover = Math.min(rimWidth, R * 0.95);
        const scale = Math.max(R / img.height, cover / img.width);
        const w = img.width * scale;
        const h = img.height * scale;
        a.drawImage(img, -w / 2, -R * 0.52 - h / 2, w, h);
        const shade = a.createLinearGradient(0, 0, 0, -R);
        shade.addColorStop(0, 'rgba(3,4,3,0.55)');
        shade.addColorStop(0.35, 'rgba(3,4,3,0)');
        a.fillStyle = shade;
        a.fillRect(-R, -R, R * 2, R);
      } else {
        a.rotate(-Math.PI / 2); // text runs along the slice, outward
        a.fillStyle = '#eaf5ea';
        a.font = `600 ${Math.round(14 * dpr)}px Oswald, sans-serif`;
        a.textAlign = 'right';
        a.textBaseline = 'middle';
        a.fillText(fitText(a, item.title, R * 0.72), R - 16 * dpr, 0);
      }
      a.restore();

      // slice divider
      a.save();
      a.strokeStyle = 'rgba(63,224,102,0.5)';
      a.lineWidth = 1.5 * dpr;
      a.beginPath();
      a.moveTo(c, c);
      a.lineTo(c + Math.cos(from) * R, c + Math.sin(from) * R);
      a.stroke();
      a.restore();
    });

    // rim with a peg at every slice boundary
    a.strokeStyle = '#1f9e40';
    a.lineWidth = 9 * dpr;
    a.beginPath();
    a.arc(c, c, R + 4.5 * dpr, 0, M.TAU);
    a.stroke();
    a.fillStyle = '#eaf5ea';
    for (let i = 0; i < slices.length; i++) {
      const ang = i * step;
      a.beginPath();
      a.arc(c + Math.cos(ang) * (R + 4.5 * dpr), c + Math.sin(ang) * (R + 4.5 * dpr), 3 * dpr, 0, M.TAU);
      a.fill();
    }
  }

  function drawFrame(rotation, winner = null) {
    const g = geometry();
    const { S, c } = g;
    ctx.clearRect(0, 0, S, S);
    if (!artCanvas || !slices.length) return;

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(rotation);
    ctx.drawImage(artCanvas, -c, -c);
    ctx.restore();

    if (winner !== null && slices.length > 1) {
      ctx.fillStyle = 'rgba(3,4,3,0.62)';
      slices.forEach((_, i) => {
        if (i === winner) return;
        wedge(g, i * g.step + rotation, (i + 1) * g.step + rotation);
        ctx.fill();
      });
    }

    // hub
    ctx.beginPath();
    ctx.arc(c, c, 22 * dpr, 0, M.TAU);
    ctx.fillStyle = '#07090a';
    ctx.fill();
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#3fe066';
    ctx.stroke();

    // pointer (flicks as the wheel crosses each divider)
    ctx.save();
    ctx.translate(c, 4 * dpr);
    ctx.rotate(-kick * 0.35);
    ctx.beginPath();
    ctx.moveTo(-13 * dpr, 0);
    ctx.lineTo(13 * dpr, 0);
    ctx.lineTo(0, 36 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#3fe066';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#04150a';
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- building the wheel ---------- */

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = Math.max(240, Math.min(MAX_CANVAS_CSS, stageEl.clientWidth || MAX_CANVAS_CSS));
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
  }

  function candidates() {
    const items = api() ? api().getItems() : [];
    return items.filter((i) => !i.watched && (kind === 'all' || i.kind === kind));
  }

  function renderKinds() {
    const items = (api() ? api().getItems() : []).filter((i) => !i.watched);
    kindsEl.innerHTML = '';
    for (const [value, label] of KINDS) {
      const count = value === 'all' ? items.length : items.filter((i) => i.kind === value).length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `wheel-chip${value === kind ? ' is-active' : ''}`;
      chip.disabled = count === 0 && value !== kind;
      chip.textContent = `${label} ${count}`;
      chip.addEventListener('click', () => {
        if (spinning || kind === value) return;
        kind = value;
        hasSpun = false;
        buildWheel();
      });
      kindsEl.appendChild(chip);
    }
  }

  async function buildWheel() {
    const token = ++buildToken;
    resultEl.hidden = true;
    current = null;
    renderKinds();
    pool = candidates();
    slices = sample(pool, Math.min(MAX_SLICES, pool.length));
    spinBtn.disabled = true;

    if (!pool.length) {
      noteEl.textContent = kind === 'all'
        ? 'Your watchlist is empty. Add a movie or show first, then come back and spin.'
        : `No ${kind === 'movie' ? 'movies' : 'shows'} on your watchlist yet.`;
      artCanvas = null;
      drawFrame(theta);
      return;
    }

    noteEl.textContent = 'Loading posters…';
    sizeCanvas();
    sliceImages = await Promise.all(slices.map((s) => loadImage(s.poster)));
    if (token !== buildToken) return; // a newer build replaced this one

    renderArt();
    drawFrame(theta);
    noteEl.textContent = pool.length > slices.length
      ? `Showing ${slices.length} of ${pool.length} picks. The wheel reshuffles on every spin, so every title gets an equal chance.`
      : pool.length === 1
        ? 'Only one pick on your watchlist, so the wheel has an easy decision.'
        : `${pool.length} picks on the wheel.`;
    spinBtn.disabled = false;
    spinBtn.textContent = hasSpun ? 'Spin again' : 'Spin the wheel';
  }

  /* ---------- spinning ---------- */

  function animate(from, to, token) {
    return new Promise((resolve) => {
      const started = performance.now();
      let lastSlice = M.sliceAtPointer(from, slices.length);
      const frame = (now) => {
        if (token !== spinToken) return resolve(false);
        const t = Math.min(1, (now - started) / SPIN_MS);
        theta = from + (to - from) * M.ease(t);
        const idx = M.sliceAtPointer(theta, slices.length);
        if (idx !== lastSlice) {
          lastSlice = idx;
          kick = 1;
        }
        kick *= 0.88;
        drawFrame(theta);
        if (t < 1) requestAnimationFrame(frame);
        else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  async function spin() {
    if (spinning || !pool.length) return;
    spinning = true;
    spinBtn.disabled = true;
    resultEl.hidden = true;
    kindsEl.classList.add('is-locked');

    // A fresh random selection before every spin after the first, so with a
    // long list each title is equally likely overall.
    if (hasSpun && pool.length > MAX_SLICES) {
      await buildWheel();
      if (!pool.length || !modal.classList.contains('open')) {
        spinning = false;
        kindsEl.classList.remove('is-locked');
        return;
      }
      spinBtn.disabled = true;
    }

    const token = ++spinToken;
    const winner = randomInt(slices.length);
    const offset = (randomUnit() - 0.5) * 0.7;
    const to = M.finalRotation(theta, winner, slices.length, offset, 5 + randomInt(3));
    spinBtn.textContent = 'Spinning…';

    const finished = await animate(theta, to, token);
    if (!finished) return;

    const landed = M.sliceAtPointer(theta, slices.length);
    theta = to % M.TAU;
    spinning = false;
    hasSpun = true;
    kindsEl.classList.remove('is-locked');
    drawFrame(theta, landed);
    showResult(slices[landed]);
    spinBtn.disabled = false;
    spinBtn.textContent = 'Spin again';
  }

  function showResult(item) {
    current = item;
    resultArt.hidden = !item.poster;
    if (item.poster) resultArt.src = item.poster;
    resultTitle.textContent = item.title;
    resultMeta.textContent = [item.year, item.kind === 'movie' ? 'Movie' : item.kind === 'show' ? 'Show' : null].filter(Boolean).join(' · ');
    resultEl.hidden = false;
  }

  /* ---------- open / close ---------- */

  function open() {
    modal.classList.add('open');
    if (window.cosmikBackground) window.cosmikBackground.pause();
    hasSpun = false;
    kind = 'all';
    buildWheel();
  }

  function close() {
    spinToken++;
    buildToken++;
    spinning = false;
    kindsEl.classList.remove('is-locked');
    modal.classList.remove('open');
    if (window.cosmikBackground) window.cosmikBackground.resume();
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  spinBtn.addEventListener('click', spin);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  watchedBtn.addEventListener('click', async () => {
    if (!current || !api()) return;
    const picked = current;
    watchedBtn.disabled = true;
    await api().markWatched(picked.id);
    watchedBtn.disabled = false;
    close();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (modal.classList.contains('open') && !spinning && pool.length) buildWheel();
    }, 200);
  });
})();
