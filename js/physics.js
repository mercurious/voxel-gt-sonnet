// Arcade-sim vehicle model: slip-angle tyres with a friction circle, load transfer, aero, auto gearbox.
import { clamp, lerp, smooth } from './trackgen.js';

const G = 9.81, RHO = 1.2, RW = 0.33, TWO_PI = Math.PI * 2;
const GEAR_FRAC = [0.2, 0.34, 0.5, 0.67, 0.84, 1.0];

function tcBase(x, turbo) {
  let t = 0.75 + 0.9 * x - 1.0 * x * x;
  if (turbo) t *= 0.45 + 0.55 * smooth(0.26, 0.64, x);
  return Math.max(0.05, t);
}

/** front-wheel lock available at a given speed (rad) */
export function steerLock(p, usp) { return p.lock / (1 + Math.pow(usp / 14, 1.6)); }

export class Vehicle {
  constructor(spec, track) {
    this.spec = spec;
    this.p = spec.perf;
    this.track = track;
    const p = this.p;
    this.m = p.mass;
    this.a = spec.wb * (1 - p.wf);       // CG -> front axle
    this.b = spec.wb * p.wf;             // CG -> rear axle
    this.Iz = p.mass * Math.pow(0.42 * spec.wb, 2) * 1.0;
    this.redRad = p.red * TWO_PI / 60;
    // torque scale from peak power
    let peak = 0; for (let x = 0.2; x <= 1.0; x += 0.01) peak = Math.max(peak, x * tcBase(x, p.turbo));
    this.Tscale = (p.hp * 745.7) / (peak * this.redRad);
    const vtop = p.topSpeed * 1.04;
    this.ratios = GEAR_FRAC.map((f) => this.redRad * RW / (vtop * f));
    this.eta = 0.9;
    this.idle = 1100;
    this.reset(0, 0, 0, 0);
    this.q = { i: 0, u: 0, off: 0, y: 0, slope: 0, tx: 0, tz: 1, nx: 1, nz: 0 };
    this.hit = 0;
    this.assist = 0.55;
    this.fall = 0;
  }

  reset(x, z, psi, speed = 0, y = 0) {
    this.x = x; this.z = z; this.y = y; this.psi = psi;
    this.vx = Math.sin(psi) * speed; this.vz = Math.cos(psi) * speed;
    this.r = 0; this.steer = 0; this.steerIn = 0;
    this.gear = 1; this.rpm = this.idle; this.shiftT = 0; this.te = 0; this.axSm = 0; this.latSm = 0;
    this.throttle = 0; this.brake = 0; this.hb = 0;
    this.skid = 0; this.spin = 0; this.reversing = false;
    this.u = speed; this.w = 0; this.speed = speed;
    this.pitch = 0; this.roll = 0; this.wheelAngle = 0;
    this.onGrass = false; this.onKerb = false; this.surf = 1;
  }

  /** place on the track at sample index (with lateral offset), facing along it */
  placeOnTrack(i, lat = 0, speed = 0) {
    const t = this.track;
    i = ((i % t.N) + t.N) % t.N;
    this.reset(t.X[i] + t.NX[i] * lat, t.Z[i] + t.NZ[i] * lat, t.PSI[i], speed, t.Y[i]);
    this.q.i = i;
    t.query(this.x, this.z, i, this.q);
    this.y = this.q.y;
  }

  relocateToTrack() {
    const t = this.track;
    t.queryGlobal(this.x, this.z, this.q);
    const i = this.q.i;
    this.placeOnTrack(i, clamp(this.q.off, -t.hw + 2.5, t.hw - 2.5), 0);
  }

  step(dt, ctl) {
    const t = this.track, p = this.p, m = this.m;
    if (ctl.hold) { this.vx = 0; this.vz = 0; this.r = 0; }
    const sinP = Math.sin(this.psi), cosP = Math.cos(this.psi);
    const fx = sinP, fz = cosP, lx = cosP, lz = -sinP;
    const u = this.vx * fx + this.vz * fz;
    const w = this.vx * lx + this.vz * lz;
    const speed = Math.hypot(u, w);
    this.u = u; this.w = w; this.speed = speed;

    // ---- track query / surface ----
    const q = t.query(this.x, this.z, this.q.i, this.q);
    const off = q.off, aoff = Math.abs(off);
    const hw = t.hw;
    let surf = 1.0;
    this.onGrass = false; this.onKerb = false;
    if (aoff > hw + 1.3) { surf = 0.58; this.onGrass = true; }
    else if (aoff > hw) { surf = 0.97; this.onKerb = true; }
    this.surf = surf;

    // ---- inputs ----
    let thr = clamp(ctl.throttle, 0, 1), brk = clamp(ctl.brake, 0, 1), hb = ctl.hb ? 1 : 0;
    // reverse logic
    let reverse = false;
    if (brk > 0.05 && u < 1.2 && thr < 0.05) { reverse = true; }
    if (thr > 0.05 && u < -1.0) { brk = Math.max(brk, thr); thr = 0; }
    this.reversing = reverse;
    this.throttle = thr; this.brake = reverse ? 0 : brk; this.hb = hb;

    // steering
    const steerCmd = clamp(ctl.steer, -1, 1);
    const usp = Math.abs(u);
    const rate = (Math.abs(steerCmd) > Math.abs(this.steerIn) ? 5.0 : 8.0) / (1 + usp / 45);
    this.steerIn += clamp(steerCmd - this.steerIn, -rate * dt, rate * dt);
    const lock = steerLock(p, usp);
    let delta = this.steerIn * lock;
    // counter-steer assist (steer toward the direction of travel when sliding)
    if (usp > 6 && this.assist > 0) {
      const beta = Math.atan2(w, Math.max(usp, 3));
      const as = clamp(beta * 1.15, -0.32, 0.32) * this.assist * (1 - Math.abs(this.steerIn) * 0.5);
      delta += as * Math.sign(u);
    }
    // assist: never ask the front tyres for more than a little past their peak slip angle
    if (this.assist > 0 && u > 0.5) {
      const wfa = Math.atan2(w + this.a * this.r, Math.max(usp, 3));
      const lim = 0.24 - 0.07 * this.assist;
      delta = clamp(delta, wfa - lim, wfa + lim);
    }
    delta = clamp(delta, -0.7, 0.7);
    this.steer = delta;

    // ---- engine ----
    const gi = this.gear - 1;
    let ratio = this.ratios[gi];
    const rpmW = (usp / RW) * ratio * 60 / TWO_PI;
    const x = clamp(this.rpm / p.red, 0, 1.05);
    this.te += (thr - this.te) * Math.min(1, dt * p.lag);
    if (this.shiftT > 0) this.shiftT -= dt;
    let Fdrive = 0;
    if (reverse) {
      const gr = this.ratios[0] * 1.1;
      Fdrive = -brk * Math.min(this.Tscale * 0.9 * gr * this.eta / RW, m * G * 0.35) * (u > -9 ? 1 : 0);
    } else {
      let T = 0;
      if (this.shiftT <= 0 && this.rpm < p.red * 0.995) T = this.Tscale * tcBase(x, p.turbo) * this.te;
      Fdrive = T * ratio * this.eta / RW;
      // engine braking
      const eb = (1 - this.te) * 0.1 * this.Tscale * ratio / RW * x;
      Fdrive -= eb * Math.sign(u) * clamp(usp / 3, 0, 1);
    }
    // rpm dynamics
    let rpmTarget = Math.max(rpmW, this.idle);
    if (usp < 6 || rpmW < 0.3 * p.red) rpmTarget = Math.max(rpmTarget, this.idle + thr * (0.62 * p.red - this.idle) * (this.gear === 1 || rpmW < 0.3 * p.red ? 1 : 0));
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * 14);
    // gearbox
    if (!reverse && this.shiftT <= 0) {
      if (this.gear < 6 && rpmW > 0.945 * p.red && thr > 0.3) { this.gear++; this.shiftT = 0.14; }
      else if (this.gear > 1 && rpmW < 0.42 * p.red) { this.gear--; this.shiftT = 0.05; }
      else if (this.gear > 1 && brk > 0.5 && rpmW < 0.55 * p.red) { this.gear--; this.shiftT = 0.05; }
    }

    // ---- aero ----
    const v2 = speed * speed;
    const Fdown = 0.5 * RHO * p.clA * v2;
    const mg = m * G;
    // ---- load transfer ----
    const ax = this.axSm;
    const dN = clamp(m * ax * p.h / (this.a + this.b), -0.35 * mg, 0.35 * mg);
    let Nf = mg * p.wf - dN + Fdown * 0.4;
    let Nr = mg * (1 - p.wf) + dN + Fdown * 0.6;
    Nf = Math.max(Nf, mg * 0.12); Nr = Math.max(Nr, mg * 0.12);
    const mu = p.mu * surf;

    // ---- longitudinal demands ----
    const sgn = clamp(u / 1.5, -1, 1);
    const Fb = this.brake * 1.1 * mg * Math.min(p.mu, 1.25);
    let Fxf = -sgn * Fb * 0.62, Fxr = -sgn * Fb * 0.38;
    if (p.drive === 'AWD') { Fxf += Fdrive * 0.38; Fxr += Fdrive * 0.62; } else Fxr += Fdrive;
    if (hb) Fxr += -sgn * 0.95 * mu * Nr;
    const muNf = mu * Nf, muNr = mu * Nr;
    Fxf = clamp(Fxf, -0.985 * muNf, 0.985 * muNf);
    Fxr = clamp(Fxr, -0.985 * muNr, 0.985 * muNr);
    const capF = Math.sqrt(Math.max(0, 1 - (Fxf / muNf) ** 2)), capR = Math.sqrt(Math.max(0, 1 - (Fxr / muNr) ** 2));
    const spinning = Math.max(0, Math.abs(Fxr) / muNr - 0.9);

    // ---- slip angles & lateral forces ----
    const den = Math.max(usp, 3.0);
    const wf = w + this.a * this.r, wr = w - this.b * this.r;
    const sg = u >= 0 ? 1 : -1;
    const af = Math.atan2(wf, den) * sg - delta * sg + (sg < 0 ? 0 : 0);
    const ar = Math.atan2(wr, den) * sg;
    const fade = clamp((speed - 0.4) / 3.2, 0, 1);
    const B = 14, C = 1.4;
    let Fyf = -muNf * capF * Math.sin(C * Math.atan(B * af)) * fade * sg;
    let Fyr = -muNr * capR * Math.sin(C * Math.atan(B * ar)) * fade * sg * (1 - 0.62 * hb);
    // low-speed lateral damping
    const lowS = 1 - fade;
    const Fdamp = -m * 6.0 * w * lowS;

    // ---- assemble ----
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const Fbx = Fxf * cd - Fyf * sd + Fxr;                 // body forward
    const Fby = Fxf * sd + Fyf * cd + Fyr + Fdamp;          // body left
    // aero drag (along velocity), rolling resistance, grass drag, grade
    const dragK = 0.5 * RHO * p.cdA;
    let Fwx = -dragK * speed * this.vx, Fwz = -dragK * speed * this.vz;
    const rr = (0.012 + (this.onGrass ? 0.06 : 0)) * mg;
    if (speed > 0.05) { Fwx -= rr * this.vx / speed; Fwz -= rr * this.vz / speed; }
    if (this.onGrass) { Fwx -= m * 0.45 * this.vx; Fwz -= m * 0.45 * this.vz; }
    const gradeF = -mg * q.slope * (fx * q.tx + fz * q.tz);
    const Fgx = gradeF * fx, Fgz = gradeF * fz;
    const accX = (Fbx * fx + Fby * lx + Fwx + Fgx) / m;
    const accZ = (Fbx * fz + Fby * lz + Fwz + Fgz) / m;
    this.vx += accX * dt; this.vz += accZ * dt;
    const torque = this.a * (Fxf * sd + Fyf * cd) - this.b * Fyr;
    this.r += (torque / this.Iz - this.r * 0.35) * dt;
    this.r = clamp(this.r, -4, 4);
    this.psi += this.r * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // smoothed accelerations for load transfer & visuals
    const axBody = Fbx / m;
    this.axSm += (axBody - this.axSm) * Math.min(1, dt * 7);
    this.latSm += (Fby / m - this.latSm) * Math.min(1, dt * 7);
    // standstill
    if (speed < 0.35 && thr < 0.05 && (brk > 0.05 || hb)) { this.vx *= 0.8; this.vz *= 0.8; }
    if (speed < 0.12 && thr < 0.05 && !reverse) { this.vx = 0; this.vz = 0; this.r *= 0.7; }

    // skid metric (for smoke / sound)
    const slipMag = Math.max(Math.abs(af), Math.abs(ar));
    this.skid = clamp((slipMag - 0.11) / 0.16, 0, 1) * clamp(speed / 6, 0, 1) * (this.onGrass ? 0.4 : 1);
    this.skid = Math.max(this.skid, clamp(spinning * 5, 0, 0.9) * clamp(1 - speed / 25, 0, 1), this.brake > 0.9 && speed > 20 && Math.abs(Fxf) > 0.97 * muNf ? 0.3 : 0);
    this.wheelAngle += (u / RW) * dt;

    // ---- walls ----
    const wall = t.wallD[q.i];
    if (aoff > wall) {
      const sgo = Math.sign(off);
      const ox = q.nx * sgo, oz = q.nz * sgo;
      const pen = aoff - wall;
      this.x -= ox * pen; this.z -= oz * pen;
      const vo = this.vx * ox + this.vz * oz;
      if (vo > 0) {
        const e = 0.18;
        this.vx -= (1 + e) * vo * ox; this.vz -= (1 + e) * vo * oz;
        // scrape speed loss along wall
        this.vx *= 0.93; this.vz *= 0.93;
        this.r *= 0.6;
        this.hit = Math.max(this.hit, vo);
      }
    }
  }

  /** visual attitude: y position, pitch, roll */
  updateVisual() {
    const t = this.track, q = this.q;
    const aoff = Math.abs(q.off);
    let y = q.y;
    if (aoff > t.hw + 1.3) {
      const far = aoff > t.hw + 4 ? t.farHeight(this.x, this.z).h : q.y;
      y = t.terrainTop(aoff, q.y, far);
    }
    this.y += (y - this.y) * 0.5;
    const slopeAlong = q.slope * (Math.sin(this.psi) * q.tx + Math.cos(this.psi) * q.tz);
    const pitchT = Math.atan(slopeAlong) + clamp(this.axSm * 0.0055, -0.05, 0.05);
    const rollT = clamp(-this.latSm * 0.0055, -0.06, 0.06) * 1.0;
    this.pitch += (pitchT - this.pitch) * 0.25;
    this.roll += (rollT - this.roll) * 0.25;
  }
}
