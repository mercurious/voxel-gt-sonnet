// Race session: grid, countdown, lap timing, AI, collisions, particles, cameras.
import * as THREE from '../vendor/three.module.js';
import { CAR_SPECS, createCarObject } from './cars.js';
import { Vehicle } from './physics.js';
import { AIDriver, speedProfile } from './ai.js';
import { clamp, lerp } from './trackgen.js';

const DT = 1 / 120;
const NAMES = ['K. Tanaka', 'M. Rossi', 'J. Weber', 'S. Ito', 'L. Moreau', 'D. Carter', 'A. Silva', 'R. Kimura', 'P. Novak', 'T. Hayes'];
const DIFF = { easy: 0.86, normal: 0.935, hard: 0.985 };
const CIRCLES = [-1.3, 0, 1.3];
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export function fmtTime(t, signed = false) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const sg = t < 0 ? '-' : (signed ? '+' : '');
  t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${sg}${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

export class Race {
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.camera = o.camera; this.sun = o.sun; this.track = o.track; this.audio = o.audio;
    this.mode = o.mode; this.laps = o.mode === 'tt' ? 99 : o.laps;
    this.pace = DIFF[o.difficulty] ?? DIFF.normal;
    const t = this.track;
    this.cars = [];
    this.acc = 0; this.t = 0; this.phase = 'countdown'; this.cd = 4.0; this.lastCdShown = 99;
    this.msg = null; this.msgT = 0; this.finishWait = 0; this.done = false;
    this.camMode = 0; this.camYaw = 0; this.shake = 0; this.camInit = false;
    this.wrongT = 0; this.showLine = true;
    this.particles = []; this.group = new THREE.Group(); this.scene.add(this.group);
    this.rand = (() => { let s = 12345 + (Math.random() * 1e6 | 0); return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    this.player = null;

    // ---- build field ----
    const player = { spec: o.spec, color: o.color, stripe: o.stripe, isPlayer: true, name: 'YOU' };
    let field = [player];
    if (this.mode === 'race') {
      const others = CAR_SPECS.filter((s) => s.id !== o.spec.id);
      const ai = [];
      for (let k = 0; k < 5; k++) {
        const spec = k < others.length ? others[k] : CAR_SPECS[Math.floor(this.rand() * CAR_SPECS.length)];
        const cols = spec.colors.filter((c) => !(spec.id === o.spec.id && c[1] === o.color));
        const c = cols[Math.floor(this.rand() * cols.length)];
        ai.push({ spec, color: c[1], stripe: this.rand() < 0.3, isPlayer: false, name: NAMES[(k * 3 + 1) % NAMES.length] });
      }
      ai.sort((a, b) => b.spec.perf.pwr * b.spec.perf.mu - a.spec.perf.pwr * a.spec.perf.mu);
      ai.splice(Math.min(4, ai.length), 0, player);
      field = ai;
    }
    field.forEach((f, k) => this.addCar(f, k));
    this.playerSpecProfile = speedProfile(t, o.spec, 1.0);

    // ---- helpers: particles, racing line markers ----
    const pg = new THREE.BoxGeometry(1, 1, 1);
    const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    this.pInst = new THREE.InstancedMesh(pg, pm, 240); this.pInst.frustumCulled = false;
    this.pInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.pInst);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 240; i++) { this.pInst.setMatrixAt(i, zero); this.pInst.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.pInst.count = 240;
    const lg = new THREE.BoxGeometry(1.2, 0.08, 2.6);
    this.lineN = 36;
    this.lineInst = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), this.lineN);
    this.lineInst.frustumCulled = false; this.lineInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.lineN; i++) this.lineInst.setColorAt(i, new THREE.Color(0, 1, 0));
    this.group.add(this.lineInst);

    // ghost (time trial)
    this.ghost = null; this.trace = []; this.bestTrace = null; this.ghostObj = null;
    if (this.mode === 'tt') {
      const gm = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false });
      this.ghostMat = gm;
    }
    this.hud = {};
    this.stepCount = 0;
  }

  addCar(f, k) {
    const t = this.track;
    const veh = new Vehicle(f.spec, t);
    const row = k >> 1, side = (k & 1) ? 3.0 : -3.0;
    const s = t.L - 7 - row * 9.5 - ((k & 1) ? 4.5 : 0);
    const i = Math.round(s / t.ds) % t.N;
    veh.placeOnTrack(i, side, 0);
    const obj = createCarObject(f.spec, f.color, f.stripe);
    obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    this.group.add(obj);
    const car = {
      id: k, name: f.name, isPlayer: f.isPlayer, spec: f.spec, color: f.color, veh, obj, ai: null, slot: k,
      lap: 0, prevS: ((veh.q.u % t.N) + t.N) % t.N * t.ds, total: 0, finished: false, finishTime: null, lapStart: 0,
      bestLap: null, lastLap: null, lapTimes: [], reaction: 0.05 + this.rand() * 0.3, est: false,
    };
    car.total = car.prevS - t.L;
    if (f.isPlayer) { this.player = car; veh.assist = this.o.assist ?? 0.85; }
    else {
      const pace = this.pace * (0.975 + this.rand() * 0.05);
      car.basePace = pace;
      car.ai = new AIDriver(veh, t, { pace, bias: (this.rand() - 0.5) * 3.0, grip: f.spec.perf.aiGrip ?? 0.93 });
      veh.assist = 0.9;
    }
    this.cars.push(car);
    return car;
  }

  // ------------------------------------------------------------------ simulation
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 12) { this.simStep(DT, input); this.acc -= DT; n++; }
    if (n === 12) this.acc = 0;
    this.updateVisuals(dt);
    this.updateCamera(dt, input);
    this.updateParticles(dt);
    this.updateHud(dt);
  }

  simStep(dt, input) {
    const t = this.track;
    this.stepCount++;
    if (this.phase === 'countdown') {
      this.cd -= dt;
      const n = this.cd > 3 ? 4 : Math.ceil(this.cd);
      if (n !== this.lastCdShown) {
        this.lastCdShown = n;
        if (n >= 1 && n <= 3) this.audio?.beep(660, 0.14, 0.2);
      }
      if (this.cd <= 0) { this.phase = 'race'; this.t = 0; this.setMsg('GO!', 1.2); this.audio?.beep(1320, 0.4, 0.28); }
    } else this.t += dt;

    // AI avoidance every few steps
    if (this.stepCount % 6 === 0) this.computeAvoidance();

    for (const c of this.cars) {
      const v = c.veh;
      let ctl;
      if (this.phase === 'countdown') {
        ctl = { steer: 0, throttle: c.isPlayer ? input.throttle : (this.cd < 1.3 ? 0.45 : 0), brake: 0, hb: false, hold: true };
      } else if (c.isPlayer && !c.finished) {
        ctl = input;
      } else if (c.isPlayer) {
        if (!this.autopilot) { this.autopilot = new AIDriver(v, t, { pace: 0.8 }); v.assist = 0.9; }
        ctl = this.autopilot.control(dt);
      } else {
        if (this.t < c.reaction) ctl = { steer: 0, throttle: 0, brake: 0, hb: false };
        else {
          // mild rubber-banding relative to the player
          const dTot = this.player.total - c.total;
          c.ai.pace = c.basePace * (1 + clamp(dTot / 1800, -0.03, 0.045));
          ctl = c.ai.control(dt);
          if (c.ai.stuck > 3.0 || Math.abs(v.q.off) > t.wallD[v.q.i] + 3) { v.relocateToTrack(); c.ai.stuck = 0; }
        }
      }
      v.step(dt, ctl);
    }
    this.collide();
    this.progress();
    if (this.player && this.mode === 'tt' && this.phase === 'race' && this.stepCount % 6 === 0) {
      const v = this.player.veh;
      this.trace.push(v.x, v.y, v.z, v.psi);
    }
    // finish handling
    if (this.player.finished && this.phase !== 'finish') { this.phase = 'finish'; this.finishWait = 0; }
    if (this.phase === 'finish') {
      this.finishWait += dt;
      const allDone = this.cars.every((c) => c.finished);
      if (this.finishWait > 7 || allDone && this.finishWait > 2.5) this.done = true;
    }
  }

  computeAvoidance() {
    const t = this.track;
    for (const c of this.cars) {
      if (!c.ai) continue;
      let best = null, bd = 1e9;
      for (const o of this.cars) {
        if (o === c) continue;
        let d = o.total - c.total;
        if (d > 0.5 && d < 22 && d < bd) {
          const dl = c.veh.q.off - o.veh.q.off;
          if (Math.abs(dl) < 2.7) { best = o; bd = d; }
        }
      }
      if (best) {
        const dl = c.veh.q.off - best.veh.q.off;
        const room = (dl >= 0) ? (t.hw - 1.8 - c.veh.q.off) : (t.hw - 1.8 + c.veh.q.off);
        let dir = dl >= 0 ? 1 : -1;
        if (room < 2.2) dir = -dir;
        c.ai.avoidT = dir * 3.2;
        c.ai.cap = bd < 7 && Math.abs(dl) < 1.7 ? Math.max(best.veh.u * 1.03, 8) : null;
      } else { c.ai.avoidT = 0; c.ai.cap = null; }
    }
  }

  collide() {
    const cars = this.cars;
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a].veh, B = cars[b].veh;
        const dx = B.x - A.x, dz = B.z - A.z;
        if (dx * dx + dz * dz > 36) continue;
        const sa = Math.sin(A.psi), ca = Math.cos(A.psi), sb = Math.sin(B.psi), cb = Math.cos(B.psi);
        for (const ia of CIRCLES) for (const ib of CIRCLES) {
          const pax = A.x + sa * ia, paz = A.z + ca * ia, pbx = B.x + sb * ib, pbz = B.z + cb * ib;
          const rr = 0.98 * 2 - 0.05;
          let nx = pbx - pax, nz = pbz - paz;
          const d2 = nx * nx + nz * nz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2); nx /= d; nz /= d;
          const pen = rr - d;
          const wa = B.m / (A.m + B.m), wb = A.m / (A.m + B.m);
          A.x -= nx * pen * wa; A.z -= nz * pen * wa; B.x += nx * pen * wb; B.z += nz * pen * wb;
          const rvx = B.vx - A.vx, rvz = B.vz - A.vz;
          const vn = rvx * nx + rvz * nz;
          if (vn < 0) {
            const j = -(1 + 0.25) * vn / (1 / A.m + 1 / B.m);
            A.vx -= nx * j / A.m; A.vz -= nz * j / A.m; B.vx += nx * j / B.m; B.vz += nz * j / B.m;
            // yaw kick from off-centre contact
            const lAx = sa * ia, lAz = ca * ia, lBx = sb * ib, lBz = cb * ib;
            A.r += clamp((lAz * -nx * j - lAx * -nz * j) / A.Iz * 0.5, -1.5, 1.5);
            B.r += clamp((lBz * nx * j - lBx * nz * j) / B.Iz * 0.5, -1.5, 1.5);
            const mag = -vn;
            A.hit = Math.max(A.hit, mag * 0.6); B.hit = Math.max(B.hit, mag * 0.6);
            if (mag > 2.5) this.spark((pax + pbx) / 2, (A.y + B.y) / 2 + 0.5, (paz + pbz) / 2, mag);
          }
        }
      }
    }
    // impact feedback for the player
    const pv = this.player.veh;
    if (pv.hit > 1.5) {
      this.shake = Math.max(this.shake, Math.min(pv.hit * 0.05, 0.6));
      this.audio?.thump(pv.hit * 0.35);
      this.spark(pv.x, pv.y + 0.5, pv.z, pv.hit);
    }
    for (const c of cars) if (c.veh.hit > 3 && !c.isPlayer) this.spark(c.veh.x, c.veh.y + 0.5, c.veh.z, c.veh.hit);
    for (const c of cars) c.veh.hit = 0;
  }

  progress() {
    const t = this.track, L = t.L, N = t.N, ds = t.ds;
    for (const c of this.cars) {
      const q = c.veh.q;
      const s = (((q.u % N) + N) % N) * ds;
      const prev = c.prevS;
      if (prev > L * 0.75 && s < L * 0.25) {
        c.lap++;
        if (c.lap >= 2 && !c.finished) {
          const lt = this.t - c.lapStart;
          c.lapTimes.push(lt); c.lastLap = lt;
          const isBest = c.bestLap === null || lt < c.bestLap;
          if (isBest) c.bestLap = lt;
          if (c.isPlayer) {
            if (this.mode === 'tt') {
              if (isBest && this.trace.length > 20) { this.bestTrace = this.trace.slice(); this.ensureGhost(); }
              this.trace = [];
            }
            if (c.lap <= this.laps) this.setMsg(c.lap === this.laps ? 'FINAL LAP' : `LAP ${c.lap}`, 1.6, isBest ? `${isBest && c.lapTimes.length > 1 ? 'BEST LAP ' : 'LAP TIME '}${fmtTime(lt)}` : fmtTime(lt));
            this.o.onLap?.(c, lt, isBest);
          }
        }
        c.lapStart = this.t;
        if (c.lap === 2 && c.isPlayer) this.setMsg(this.laps === 2 ? 'FINAL LAP' : 'LAP 2', 1.6);
        if (c.lap > this.laps && !c.finished) {
          c.finished = true; c.finishTime = this.t;
          c.finishPos = this.cars.filter((x) => x.finished).length;
          if (c.isPlayer) this.setMsg('FINISH!', 3.5, `P${c.finishPos}`);
        }
      } else if (prev < L * 0.25 && s > L * 0.75 && c.lap >= 1) {
        c.lap--;
      }
      c.prevS = s;
      c.total = (c.lap - 1) * L + s;
      c.s = s;
    }
    // wrong-way detection for the player
    const pv = this.player.veh;
    const dot = Math.sin(pv.psi) * pv.q.tx + Math.cos(pv.psi) * pv.q.tz;
    if (dot < -0.35 && pv.speed > 4) this.wrongT += DT; else this.wrongT = Math.max(0, this.wrongT - DT * 2);
  }

  standings() {
    const L = this.track.L;
    const list = this.cars.slice();
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.total - a.total;
    });
    list.forEach((c, i) => { c.pos = i + 1; });
    return list;
  }

  setMsg(text, dur = 1.5, sub = '') { this.msg = { text, sub }; this.msgT = dur; }

  ensureGhost() {
    if (!this.ghostObj) {
      this.ghostObj = createCarObject(this.o.spec, this.o.color, this.o.stripe, { material: this.ghostMat });
      this.group.add(this.ghostObj);
    }
  }

  // ------------------------------------------------------------------ visuals
  updateVisuals(dt) {
    for (const c of this.cars) {
      const v = c.veh;
      v.updateVisual();
      const o = c.obj;
      o.position.set(v.x, v.y, v.z);
      o.rotation.y = v.psi;
      const ud = o.userData;
      ud.chassis.rotation.x = -v.pitch;
      ud.chassis.rotation.z = -v.roll;
      ud.brake.visible = v.brake > 0.1 || v.reversing;
      for (const w of ud.wheels) {
        if (w.front) w.pivot.rotation.y = v.steer;
        w.spin.rotation.x = v.wheelAngle;
      }
      if (v.skid > 0.25 && v.speed > 4) this.emitSmoke(c, v.skid);
    }
    if (this.ghostObj && this.bestTrace && this.phase === 'race') {
      const idx = Math.floor((this.t - this.player.lapStart) * 20) ;
      const k = idx * 4;
      if (k + 3 < this.bestTrace.length) {
        this.ghostObj.visible = true;
        this.ghostObj.position.set(this.bestTrace[k], this.bestTrace[k + 1], this.bestTrace[k + 2]);
        this.ghostObj.rotation.y = this.bestTrace[k + 3];
      } else this.ghostObj.visible = false;
    }
    // sun follows player
    const pv = this.player.veh, th = this.track.meta.theme;
    const sd = th.sunDir;
    this.sun.position.set(pv.x + sd[0] * 90, pv.y + sd[1] * 90, pv.z + sd[2] * 90);
    this.sun.target.position.set(pv.x, pv.y, pv.z);
    this.sun.target.updateMatrixWorld();
    // racing line helper
    this.updateLine();
  }

  updateLine() {
    const li = this.lineInst;
    li.visible = this.showLine && this.phase !== 'finish';
    if (!li.visible) return;
    const t = this.track, pv = this.player.veh, N = t.N;
    const i0 = pv.q.i;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), qt = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const prof = this.playerSpecProfile;
    const u = Math.max(pv.u, 10);
    for (let k = 0; k < this.lineN; k++) {
      const i = (i0 + 8 + Math.round(k * (4.0 + u * 0.06) / t.ds)) % N;
      const j = (i + 2) % N;
      p.set(t.RX[i], t.Y[i] + 0.22, t.RZ[i]);
      qt.setFromAxisAngle(up, Math.atan2(t.RX[j] - t.RX[i], t.RZ[j] - t.RZ[i]));
      m.compose(p, qt, s); li.setMatrixAt(k, m);
      const vt = prof[i] * 0.97;
      const c = pv.u > vt * 1.12 ? 0 : pv.u > vt * 0.9 ? 1 : 2;
      col.setRGB(c === 0 ? 1 : c === 1 ? 1 : 0.1, c === 0 ? 0.12 : c === 1 ? 0.85 : 1, c === 2 ? 0.2 : 0.1);
      li.setColorAt(k, col);
    }
    li.instanceMatrix.needsUpdate = true; li.instanceColor.needsUpdate = true;
  }

  emitSmoke(c, skid) {
    if (Math.random() > 0.55 * skid + 0.15) return;
    const v = c.veh, sp = Math.sin(v.psi), cp = Math.cos(v.psi);
    const wx = v.spec.W / 2 - 0.2, bz = -v.spec.wb / 2;
    for (const sx of [-1, 1]) {
      if (this.particles.length > 220) return;
      this.particles.push({
        x: v.x + cp * wx * sx + sp * bz, y: v.y + 0.15, z: v.z - sp * wx * sx + cp * bz,
        vx: v.vx * 0.25 + (Math.random() - 0.5) * 0.8, vy: 0.4 + Math.random() * 0.7, vz: v.vz * 0.25 + (Math.random() - 0.5) * 0.8,
        life: 0, max: 0.7 + Math.random() * 0.5, size: 0.5 + Math.random() * 0.35, spark: false,
      });
    }
  }

  spark(x, y, z, mag) {
    const n = Math.min(10, 3 + Math.floor(mag));
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 230) return;
      this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 8, vy: 1 + Math.random() * 5, vz: (Math.random() - 0.5) * 8, life: 0, max: 0.3 + Math.random() * 0.3, size: 0.16, spark: true });
    }
  }

  updateParticles(dt) {
    const inst = this.pInst, m = new THREE.Matrix4(), col = new THREE.Color(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; p.life += dt;
      if (p.life >= p.max) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.spark) p.vy -= 18 * dt; else { p.vx *= 0.97; p.vz *= 0.97; }
    }
    for (let i = 0; i < 240; i++) {
      const p = ps[i];
      if (!p) { inst.setMatrixAt(i, zero); continue; }
      const f = p.life / p.max;
      const sz = p.spark ? p.size : p.size * (1 + f * 2.2) * (1 - f * 0.4);
      m.makeScale(sz, sz, sz); m.setPosition(p.x, p.y, p.z);
      inst.setMatrixAt(i, m);
      if (p.spark) col.setRGB(1, 0.55 + 0.4 * (1 - f), 0.1); else { const g = 0.85 - f * 0.25; col.setRGB(g, g, g); }
      inst.setColorAt(i, col);
    }
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera
  cycleCamera() { this.camMode = (this.camMode + 1) % 4; this.camInit = false; }

  updateCamera(dt, input) {
    const cam = this.camera, v = this.player.veh;
    const sp = Math.sin(v.psi), cp = Math.cos(v.psi);
    const spd = v.speed;
    this.shake *= Math.pow(0.02, dt);
    const shk = this.shake;
    const jit = () => (Math.random() - 0.5) * shk;
    if (!this.camInit) { this.camYaw = v.psi; this.camInit = true; }
    const kk = 1 - Math.exp(-dt * (this.camMode === 1 ? 4.0 : 5.5));
    // follow heading, biased a little toward the velocity direction so drifts show
    let target = v.psi;
    if (spd > 8) target = v.psi + clamp(Math.atan2(v.w, Math.max(v.u, 4)), -0.4, 0.4) * 0.55 * Math.sign(v.u || 1);
    this.camYaw += wrapPi(target - this.camYaw) * kk;
    let fov = 62;
    if (this.camMode === 0 || this.camMode === 1) {
      const dist = (this.camMode === 0 ? 6.3 : 9.2) + spd * 0.014, hgt = this.camMode === 0 ? 2.35 : 3.6;
      const px = v.x - Math.sin(this.camYaw) * dist, pz = v.z - Math.cos(this.camYaw) * dist;
      let py = v.y + hgt;
      cam.position.set(px + jit(), py + jit(), pz + jit());
      cam.lookAt(v.x + sp * 3.5, v.y + 1.15, v.z + cp * 3.5);
      fov = 60 + Math.min(spd, 90) * 0.13;
    } else if (this.camMode === 2) {
      // cockpit
      const ex = v.x + cp * 0.0 + sp * 0.15, ez = v.z - sp * 0.0 + cp * 0.15;
      cam.position.set(v.x + sp * 0.05 + cp * 0.3, v.y + 1.05, v.z + cp * 0.05 - sp * 0.3);
      cam.position.x += jit(); cam.position.y += jit(); cam.position.z += jit();
      const la = v.psi - v.steer * 0.25;
      cam.lookAt(cam.position.x + Math.sin(la) * 10, cam.position.y - 0.35 + Math.sin(v.pitch) * 4, cam.position.z + Math.cos(la) * 10);
      fov = 74 + Math.min(spd, 90) * 0.12;
    } else {
      cam.position.set(v.x + sp * (v.spec.L / 2 + 0.5) + jit(), v.y + 0.45 + jit(), v.z + cp * (v.spec.L / 2 + 0.5) + jit());
      cam.lookAt(v.x + sp * 30, v.y + 0.9, v.z + cp * 30);
      fov = 70 + Math.min(spd, 90) * 0.14;
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * 0.1; cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt) {
    const p = this.player, v = p.veh;
    const st = this.standings();
    if (this.msgT > 0) this.msgT -= dt;
    let cdText = '';
    if (this.phase === 'countdown') cdText = this.cd > 3 ? 'READY' : String(Math.ceil(this.cd));
    const lapNow = this.phase === 'countdown' ? 0 : this.t - p.lapStart;
    this.hud = {
      kmh: Math.round(v.speed * 3.6), gear: v.reversing ? 'R' : (v.speed < 0.5 && v.throttle < 0.05 ? 'N' : String(v.gear)),
      rpm: clamp((v.rpm - 1000) / (v.p.red - 1000), 0, 1), rpmAbs: v.rpm, redFrac: 0.93,
      lap: clamp(p.lap, 1, this.laps), laps: this.laps, pos: p.pos, count: this.cars.length,
      lapNow, best: p.bestLap, last: p.lastLap, total: this.t,
      cd: cdText, msg: this.msgT > 0 ? this.msg : null, wrongWay: this.wrongT > 1.0,
      throttle: v.throttle, brake: v.brake, skid: v.skid, mode: this.mode, phase: this.phase,
      boost: v.te, onGrass: v.onGrass, finished: p.finished,
    };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry && !o.userData.shared) { /* shared geometries are cached */ } });
    this.pInst.geometry.dispose(); this.pInst.material.dispose();
    this.lineInst.geometry.dispose(); this.lineInst.material.dispose();
  }
}
