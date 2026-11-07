// AI driver: follows the racing line with a braking-aware speed profile and pure-pursuit steering.
import { clamp } from './trackgen.js';
import { steerLock } from './physics.js';

const G = 9.81, RHO = 1.2;

/** Speed profile (m/s) along the racing line for a given car. */
export function speedProfile(track, spec, grip = 0.93) {
  const { N, ds, KR } = track;
  const p = spec.perf;
  const mu = p.mu * grip;
  const kAero = 0.5 * RHO * p.clA / p.mass;
  const vmax = p.topSpeed * 0.985;
  const v = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(KR[i]);
    const den = k - mu * kAero;
    let vl = den > 1e-6 ? Math.sqrt(mu * G / den) : vmax;
    v[i] = Math.min(vl, vmax);
  }
  const aB = 0.86 * p.mu * G;
  const P = p.hp * 745.7 * 0.9;
  const tf = p.drive === 'AWD' ? 0.72 : 0.58;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N * 2 - 1; i >= 0; i--) {
      const a = i % N, b = (i + 1) % N;
      const drag = 0.5 * RHO * p.cdA * v[b] * v[b] / p.mass;
      const vb = Math.sqrt(v[b] * v[b] + 2 * (aB + drag) * ds);
      if (vb < v[a]) v[a] = vb;
    }
    for (let i = 0; i < N * 2; i++) {
      const a = i % N, b = (i + 1) % N;
      const vv = Math.max(v[a], 6);
      const acc = Math.min(p.mu * G * tf, P / (p.mass * vv) - 0.5 * RHO * p.cdA * vv * vv / p.mass);
      const vn = Math.sqrt(v[a] * v[a] + 2 * Math.max(acc, 0.5) * ds);
      if (vn < v[b]) v[b] = vn;
    }
  }
  return v;
}

export class AIDriver {
  constructor(vehicle, track, opts = {}) {
    this.v = vehicle; this.track = track;
    this.profile = speedProfile(track, vehicle.spec, opts.grip ?? 0.93);
    this.pace = opts.pace ?? 0.95;
    this.bias = opts.bias ?? 0;      // lateral line bias (m)
    this.avoid = 0; this.avoidT = 0;
    this.stuck = 0;
    this.out = { steer: 0, throttle: 0, brake: 0, hb: false };
    this.cap = null;
  }

  control(dt) {
    const v = this.v, t = this.track, q = v.q, N = t.N, ds = t.ds;
    const u = v.u;
    const i = q.i;
    // lateral offset target (line bias + avoidance), keep inside the road
    const lim = t.hw - 2.0;
    this.avoid += (this.avoidT - this.avoid) * Math.min(1, dt * 1.6);
    const lat = clamp(this.bias + this.avoid, -lim - t.ROFF[i], lim - t.ROFF[i]);
    // pure pursuit target
    const la = clamp(6 + 0.36 * Math.max(u, 0), 6, 40);
    const j = (i + Math.round(la / ds)) % N;
    const tx = t.RX[j] + t.NX[j] * lat, tz = t.RZ[j] + t.NZ[j] * lat;
    const sP = Math.sin(v.psi), cP = Math.cos(v.psi);
    const dx = tx - v.x, dz = tz - v.z;
    const xl = dx * sP + dz * cP, yl = dx * cP - dz * sP;
    const alpha = Math.atan2(yl, Math.max(xl, 0.5));
    const dCmd = Math.atan2(2 * v.spec.wb * Math.sin(alpha), la);
    const usp = Math.abs(u);
    const lock = steerLock(v.p, usp);
    let steer = clamp(dCmd / lock, -1, 1);
    // speed control
    const jv = (i + Math.round((5 + 0.45 * Math.max(u, 0)) / ds)) % N;
    let vt = this.profile[jv] * this.pace;
    // recovery: off the road => slow down and steer back
    if (this.cap !== null) vt = Math.min(vt, this.cap);
    if (Math.abs(q.off) > t.hw + 1.5) vt = Math.min(vt, 18);
    const err = vt - u;
    let thr = 0, brk = 0;
    if (err > 0) thr = clamp(0.2 + err * 0.4, 0, 1);
    else brk = clamp(-err * 0.22, 0, 1);
    // ease off when the car is sliding
    const slip = Math.abs(Math.atan2(v.w, Math.max(usp, 3)));
    if (slip > 0.16) thr *= clamp(1 - (slip - 0.16) * 5, 0.15, 1);
    if (v.onGrass) thr = Math.min(thr, 0.6);
    // stuck detection -> reverse out / relocate
    if (usp < 1.5 && thr > 0.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    this.out.steer = steer; this.out.throttle = thr; this.out.brake = brk; this.out.hb = false;
    return this.out;
  }
}
