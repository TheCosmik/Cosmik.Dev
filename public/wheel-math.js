// Pure math for the "spin for tonight's pick" wheel, kept separate from the
// drawing code so it can be tested on its own.
//
// Canvas angles run clockwise starting at 3 o'clock. Slice i covers
// [i * step, (i + 1) * step) before the wheel is rotated by theta, and the
// pointer sits at 12 o'clock.
(function (root) {
  const TAU = Math.PI * 2;
  const POINTER = Math.PI * 1.5;

  const mod = (n, m) => ((n % m) + m) % m;

  // Which slice is under the pointer when the wheel is rotated by theta.
  function sliceAtPointer(theta, count) {
    const step = TAU / count;
    return Math.min(count - 1, Math.floor(mod(POINTER - theta, TAU) / step));
  }

  // The rotation that leaves `winner` under the pointer, always turning
  // forward by at least `extraSpins` full turns. `offset` (-0.5..0.5, as a
  // fraction of one slice) is where inside the slice it stops, so the wheel
  // doesn't always stop dead-centre on a slice.
  function finalRotation(theta, winner, count, offset, extraSpins) {
    const step = TAU / count;
    const stopAt = (winner + 0.5 + offset) * step;
    return theta + mod(POINTER - stopAt - theta, TAU) + TAU * extraSpins;
  }

  const ease = (t) => 1 - Math.pow(1 - t, 4);

  const api = { TAU, POINTER, sliceAtPointer, finalRotation, ease };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WheelMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
