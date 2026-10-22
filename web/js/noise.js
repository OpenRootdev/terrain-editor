// Seeded 2D simplex noise + fBm / ridged variants (deterministic per seed).

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const rand = mulberry32(seed >>> 0);
  const perm = new Uint8Array(256);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) p[i] = perm[i];

  function noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g = grad2[p[ii + p[jj]] & 7];
      t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g = grad2[p[ii + i1 + p[jj + j1]] & 7];
      t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g = grad2[p[ii + 1 + p[jj + 1]] & 7];
      t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);           // ~[-1, 1]
  }

  function fbm(x, y, octaves = 5, lac = 2.0, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += a * noise(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
  }

  function ridged(x, y, octaves = 5, lac = 2.1, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += a * (1 - Math.abs(noise(x * f, y * f)));
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;                    // ~[0, 1], creases at 1
  }

  // hill profile used by the Mountain brush (persistent per world position)
  function mountainDetail(x, y) {
    return ridged(x * 0.02, y * 0.02, 5) * 2 - 1;
  }

  return { noise, fbm, ridged, mountainDetail, rand };
}
