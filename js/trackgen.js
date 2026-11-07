// Track generation: "turtle" programs (straights + arcs) -> closed smooth spline -> dense sample table.
// Map convention: programs are written in (East, North, bearing clockwise from north); world is x=East, z=-North.
import * as THREE from '../vendor/three.module.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

/** Run a turtle program. cmd: {s:len} straight, {r:radius, a:deg (+ right / - left)} arc. */
export function turtle(prog, step = 2, startBearingDeg = 90) {
  let e = 0, n = 0, b = startBearingDeg * DEG;
  const pts = [[e, n]];
  for (const c of prog) {
    if (c.s !== undefined) {
      const k = Math.max(1, Math.round(c.s / step)), d = c.s / k;
      for (let i = 0; i < k; i++) { e += Math.sin(b) * d; n += Math.cos(b) * d; pts.push([e, n]); }
    } else {
      const a = c.a * DEG, R = c.r, len = Math.abs(a) * R;
      const k = Math.max(2, Math.round(len / step)), da = a / k;
      const d = 2 * R * Math.sin(Math.abs(da) / 2);
      for (let i = 0; i < k; i++) { const bm = b + da / 2; e += Math.sin(bm) * d; n += Math.cos(bm) * d; b += da; pts.push([e, n]); }
    }
  }
  return { pts, end: { e, n, b: b / DEG } };
}

/** Scale all arcs of one sign so that the net turning equals targetDeg. */
export function normalizeArcs(prog, targetDeg, signToScale = 1) {
  let scaled = 0, fixed = 0;
  for (const c of prog) if (c.a !== undefined) { if (Math.sign(c.a) === signToScale) scaled += c.a; else fixed += c.a; }
  const k = (targetDeg - fixed) / scaled;
  return prog.map((c) => (c.a !== undefined && Math.sign(c.a) === signToScale ? { ...c, a: c.a * k } : { ...c }));
}

function smoothClosed(pts, iters) {
  const n = pts.length;
  let a = pts.map((p) => [p[0], p[1]]);
  let b = a.map((p) => [p[0], p[1]]);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const p = a[(i - 1 + n) % n], q = a[(i + 1) % n], c = a[i];
      b[i][0] = 0.25 * p[0] + 0.5 * c[0] + 0.25 * q[0];
      b[i][1] = 0.25 * p[1] + 0.5 * c[1] + 0.25 * q[1];
    }
    [a, b] = [b, a];
  }
  return a;
}

function periodicCR(vals, f) {
  const n = vals.length;
  f = ((f % 1) + 1) % 1;
  const x = f * n, i = Math.floor(x), t = x - i;
  const p0 = vals[(i - 1 + n) % n], p1 = vals[i % n], p2 = vals[(i + 1) % n], p3 = vals[(i + 2) % n];
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
export { hash2 };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.hw = def.hw || 7.5;
    const hw = this.hw;

    // ---- centreline ----
    const { pts } = turtle(def.prog, 2, def.startBearing ?? 90);
    const last = pts[pts.length - 1];
    pts.pop();
    const cnt = pts.length;
    const closed = pts.map((p, i) => [p[0] - (i / cnt) * last[0], p[1] - (i / cnt) * last[1]]);
    const sm = smoothClosed(closed, def.smooth ?? 14);
    const v3 = sm.map((p) => new THREE.Vector3(p[0], 0, -p[1]));
    const curve = new THREE.CatmullRomCurve3(v3, true, 'centripetal');
    curve.arcLengthDivisions = cnt * 8;
    this.L = curve.getLength();
    const N = Math.round(this.L / 1.0);
    this.N = N;
    this.ds = this.L / N;
    const sp = curve.getSpacedPoints(N);
    const X = this.X = new Float32Array(N), Z = this.Z = new Float32Array(N);
    for (let i = 0; i < N; i++) { X[i] = sp[i].x; Z[i] = sp[i].z; }
    const TX = this.TX = new Float32Array(N), TZ = this.TZ = new Float32Array(N);
    const NX = this.NX = new Float32Array(N), NZ = this.NZ = new Float32Array(N);
    const PSI = this.PSI = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let tx = X[b] - X[a], tz = Z[b] - Z[a];
      const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      TX[i] = tx; TZ[i] = tz; NX[i] = tz; NZ[i] = -tx; PSI[i] = Math.atan2(tx, tz);
    }
    // curvature (signed, + = left)
    const K = this.K = new Float32Array(N);
    const KW = 5;
    for (let i = 0; i < N; i++) {
      const a = (i - KW + N) % N, b = (i + KW) % N;
      K[i] = wrapPi(PSI[b] - PSI[a]) / (2 * KW * this.ds);
    }
    const Ks = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -6; k <= 6; k++) s += K[(i + k + N) % N]; Ks[i] = s / 13; }
    this.K.set(Ks);

    // ---- elevation ----
    const Y = this.Y = new Float32Array(N);
    const ctl = def.elev || [[0, 0], [0.5, 0]];
    // resample control list to a regular array for periodic CR (control fractions must be sorted)
    const M = 64, reg = [];
    for (let k = 0; k < M; k++) {
      const f = k / M;
      let a = ctl[ctl.length - 1], b = ctl[0];
      for (let j = 0; j < ctl.length; j++) { if (ctl[j][0] <= f) a = ctl[j]; }
      for (let j = ctl.length - 1; j >= 0; j--) { if (ctl[j][0] > f) b = ctl[j]; }
      let fa = a[0], fb = b[0];
      if (fb <= fa) fb += 1;
      const ff = f < fa ? f + 1 : f;
      const t = fb === fa ? 0 : (ff - fa) / (fb - fa);
      reg.push(lerp(a[1], b[1], t * t * (3 - 2 * t)));
    }
    for (let i = 0; i < N; i++) Y[i] = periodicCR(reg, i / N);
    // gaussian smooth
    {
      const tmp = new Float32Array(N), R = 40, sg = 18;
      const wts = []; let ws = 0;
      for (let k = -R; k <= R; k++) { const w = Math.exp(-(k * k) / (2 * sg * sg)); wts.push(w); ws += w; }
      for (let i = 0; i < N; i++) { let s = 0; for (let k = -R; k <= R; k++) s += Y[(i + k + N) % N] * wts[k + R]; tmp[i] = s / ws; }
      Y.set(tmp);
    }

    // ---- crossing / bridge ----
    this.bridge = new Uint8Array(N);
    this.crossing = null;
    if (def.bridge) {
      let best = 1e9, bi = -1, bj = -1;
      for (let i = 0; i < N; i += 2) {
        for (let j = i + 300; j < N - 300 + i && j < N; j += 2) {
          const dx = X[i] - X[j], dz = Z[i] - Z[j];
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; bi = i; bj = j; }
        }
      }
      if (best < 30 * 30) {
        // refine
        for (let i = bi - 3; i <= bi + 3; i++) for (let j = bj - 3; j <= bj + 3; j++) {
          const ii = (i + N) % N, jj = (j + N) % N;
          const d = (X[ii] - X[jj]) ** 2 + (Z[ii] - Z[jj]) ** 2;
          if (d < best) { best = d; bi = ii; bj = jj; }
        }
        const over = Math.max(bi, bj), under = Math.min(bi, bj);
        this.crossing = { over, under, dist: Math.sqrt(best) };
        const { h, ramp, plateau } = def.bridge;
        for (let i = 0; i < N; i++) {
          let dd = Math.abs(i - over) * this.ds; dd = Math.min(dd, this.L - dd);
          const w = 1 - smooth(plateau, plateau + ramp, dd);
          Y[i] += h * w;
          if (h * w > 2.4) this.bridge[i] = 1;
        }
      }
    }
    let minY = 1e9, maxY = -1e9;
    for (let i = 0; i < N; i++) { minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]); }
    this.minY = minY; this.maxY = maxY;
    // slope per sample (dy/ds)
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) this.slope[i] = (Y[(i + 3) % N] - Y[(i - 3 + N) % N]) / (6 * this.ds);

    // ---- per-sample attributes ----
    this.wallD = new Float32Array(N);
    this.kerb = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      this.wallD[i] = this.bridge[i] ? hw + 1.0 : hw + 8.0;
      let k = 0; for (let j = -30; j <= 30; j += 5) k = Math.max(k, Math.abs(K[(i + j + N) % N]));
      this.kerb[i] = k > 1 / 190 && !this.bridge[i] ? 1 : 0;
    }

    // ---- racing line (relaxation toward shortest/smoothest path) ----
    this.computeRacingLine();

    // decimated samples for far-field terrain
    const dec = [];
    for (let i = 0; i < N; i += 12) dec.push(i);
    this.dec = Int32Array.from(dec);
    this.hillAmp = def.theme?.hillAmp ?? 20;
    this.skidSeed = def.seed || 1;
  }

  computeRacingLine() {
    const { N, X, Z, NX, NZ, hw } = this;
    const lim = hw - 2.6, k = 8;
    let o = new Float32Array(N), o2 = new Float32Array(N);
    const RX = new Float32Array(N), RZ = new Float32Array(N);
    for (let it = 0; it < 700; it++) {
      for (let i = 0; i < N; i++) { RX[i] = X[i] + NX[i] * o[i]; RZ[i] = Z[i] + NZ[i] * o[i]; }
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const ax = 0.5 * (RX[a] + RX[b]), az = 0.5 * (RZ[a] + RZ[b]);
        const d = (ax - RX[i]) * NX[i] + (az - RZ[i]) * NZ[i];
        o2[i] = clamp(o[i] + 0.45 * d, -lim, lim);
      }
      [o, o2] = [o2, o];
    }
    // light smoothing of the offsets
    for (let p = 0; p < 6; p++) {
      for (let i = 0; i < N; i++) o2[i] = 0.25 * o[(i - 2 + N) % N] + 0.5 * o[i] + 0.25 * o[(i + 2) % N];
      [o, o2] = [o2, o];
    }
    this.ROFF = o;
    this.RX = new Float32Array(N); this.RZ = new Float32Array(N); this.KR = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.RX[i] = X[i] + NX[i] * o[i]; this.RZ[i] = Z[i] + NZ[i] * o[i]; }
    const psi = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      psi[i] = Math.atan2(this.RX[b] - this.RX[a], this.RZ[b] - this.RZ[a]);
    }
    const kr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 4 + N) % N, b = (i + 4) % N;
      const dl = Math.hypot(this.RX[b] - this.RX[a], this.RZ[b] - this.RZ[a]);
      kr[i] = wrapPi(psi[b] - psi[a]) / dl;
    }
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -5; j <= 5; j++) s += kr[(i + j + N) % N]; this.KR[i] = s / 11; }
  }

  /** nearest-sample query near a hint index. out gets {i,u,off,y,slope,tx,tz,nx,nz} */
  query(x, z, hint, out, win = 40) {
    const { N, X, Z } = this;
    let best = 1e18, bi = hint;
    for (let k = -win; k <= win; k++) {
      let i = hint + k; if (i < 0) i += N; else if (i >= N) i -= N;
      const dx = x - X[i], dz = z - Z[i];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return this._fill(x, z, bi, out);
  }
  queryGlobal(x, z, out) {
    const { N, X, Z } = this;
    let best = 1e18, bi = 0;
    for (let i = 0; i < N; i++) {
      const dx = x - X[i], dz = z - Z[i];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return this._fill(x, z, bi, out);
  }
  _fill(x, z, bi, out) {
    const { N, X, Z, TX, TZ, NX, NZ, Y, ds } = this;
    const rx = x - X[bi], rz = z - Z[bi];
    const along = rx * TX[bi] + rz * TZ[bi];
    const t = along / ds;
    const j = t >= 0 ? (bi + 1) % N : (bi - 1 + N) % N;
    const at = Math.abs(t);
    out.i = bi;
    out.u = bi + t;
    out.off = rx * NX[bi] + rz * NZ[bi];
    out.y = Y[bi] + (Y[j] - Y[bi]) * Math.min(at, 1);
    out.slope = this.slope[bi];
    out.tx = TX[bi]; out.tz = TZ[bi]; out.nx = NX[bi]; out.nz = NZ[bi];
    return out;
  }

  /** smooth far-field height (IDW of road elevation + hills) and nearest road distance estimate */
  farHeight(x, z) {
    const { dec, X, Z, Y } = this;
    let sw = 0, sy = 0, dmin2 = 1e18;
    const inv = 1 / (2 * 70 * 70);
    for (let k = 0; k < dec.length; k++) {
      const i = dec[k];
      const dx = x - X[i], dz = z - Z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < dmin2) dmin2 = d2;
      if (d2 < 360 * 360) { const w = Math.exp(-d2 * inv); sw += w; sy += w * Y[i]; }
    }
    const base = sy / (sw + 0.05);
    const dmin = Math.sqrt(dmin2);
    const gain = Math.pow(clamp((dmin - 30) / 260, 0, 1), 1.3) * (1 - smooth(380, 560, dmin));
    const n = 0.55 * vnoise(x / 260 + 11.3, z / 260 + 4.1) + 0.3 * vnoise(x / 110 + 5.7, z / 110 + 9.2) + 0.15 * vnoise(x / 45 + 1.9, z / 45 + 7.7);
    return { h: base + this.hillAmp * gain * (n * 1.6 - 0.6) + (gain > 0 ? 0 : 0), dmin };
  }

  /** terrain top height at a given lateral distance d from the road (y of nearest sample = yn) */
  terrainTop(d, yn, far) {
    const hw = this.hw;
    if (d <= hw + 1.2) return yn;
    const sh = yn - 0.25;
    if (d <= hw + 4) return sh;
    return lerp(sh, far, smooth(hw + 4, hw + 16, d));
  }

  pose(s, lat = 0) {
    const N = this.N;
    let i = Math.round(((s % this.L) + this.L) % this.L / this.ds) % N;
    const x = this.X[i] + this.NX[i] * lat, z = this.Z[i] + this.NZ[i] * lat;
    return { i, x, z, y: this.Y[i], psi: this.PSI[i] };
  }
}
