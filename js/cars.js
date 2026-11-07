// Five real-brand cars: voxel models (built from profile tables) + physics/performance specs.
import * as THREE from '../vendor/three.module.js';
import { VoxelModel } from './voxel.js';

const VS = 0.2;      // body voxel (m)
const WVS = 0.1;     // wheel voxel (m)
const WHEEL_R = 0.33;

export const CAR_SPECS = [
  {
    id: 'rx7', brand: 'Mazda', model: 'RX-7 Spirit R', year: 2002, country: 'Japan',
    tagline: 'Rotary-powered lightweight',
    desc: 'Twin-turbo 13B rotary in a featherweight chassis. Beautifully balanced and nimble, but the rear steps out if you get greedy.',
    L: 4.30, W: 1.76, wb: 2.43,
    top: [[-2.15, .64], [-2.05, .74], [-1.7, .82], [-1.2, .82], [-0.6, .78], [0.3, .76], [1.1, .72], [1.8, .68], [2.15, .62]],
    half: [[-2.15, .70], [-1.9, .84], [-1.0, .88], [0.2, .86], [1.2, .87], [1.9, .84], [2.15, .70]],
    cab: { z0: -1.35, z1: 0.65, roof: [[-1.35, .80], [-0.95, 1.10], [-0.5, 1.21], [0.1, 1.22], [0.4, 1.10], [0.65, .74]], half: [[-1.35, .66], [-0.7, .74], [0.2, .72], [0.65, .66]] },
    paint: [
      { z: [1.85, 2.2], y: [.45, .62], ax: [.4, .8], c: 0xfff2b0 },
      { z: [-2.2, -2.0], y: [.45, .62], ax: [.3, .8], c: 0x8c1111 },
      { z: [1.95, 2.2], y: [.2, .34], ax: [0, .5], c: 0x141416 },
    ],
    wing: { z: -1.95, y: 0.9, half: 0.62, depth: 0.32, thick: 0.1, stand: [0.42, -0.42], standH: 0.1, dark: true },
    exhaust: [0.32, -0.32],
    colors: [['Vintage Red', 0xc2181e], ['Competition Yellow', 0xf0c020], ['Montego Blue', 0x1f4aa8], ['Pure White', 0xe9e9ec], ['Sunset Orange', 0xe8631a], ['Black', 0x17171b]],
    perf: { mass: 1280, hp: 280, red: 8000, drive: 'RWD', wf: 0.52, h: 0.47, mu: 1.12, cdA: 0.70, clA: 0.12, lag: 6, turbo: true, cyl: 2, snd: 'rotary', lock: 0.62 },
  },
  {
    id: 'supra', brand: 'Toyota', model: 'Supra RZ', year: 1998, country: 'Japan',
    tagline: '2JZ legend',
    desc: 'The 2JZ twin-turbo six makes monstrous torque and a very long, flat top-speed run. Stable, strong, and a little heavy in the slow stuff.',
    L: 4.51, W: 1.81, wb: 2.55,
    top: [[-2.25, .66], [-2.15, .82], [-1.85, .90], [-1.3, .88], [-0.8, .84], [0.2, .80], [1.2, .74], [1.9, .68], [2.255, .62]],
    half: [[-2.255, .72], [-2.0, .86], [-1.0, .90], [0.3, .89], [1.3, .89], [2.0, .86], [2.255, .74]],
    cab: { z0: -1.5, z1: 0.75, roof: [[-1.5, .88], [-1.1, 1.14], [-0.6, 1.26], [0.0, 1.27], [0.45, 1.12], [0.75, .76]], half: [[-1.5, .68], [-0.8, .76], [0.2, .76], [0.75, .68]] },
    paint: [
      { z: [2.0, 2.26], y: [.45, .62], ax: [.45, .86], c: 0xfff2b0 },
      { z: [-2.26, -2.05], y: [.65, .78], ax: [.1, .8], c: 0x9c1212 },
      { z: [2.1, 2.26], y: [.2, .34], ax: [0, .5], c: 0x141416 },
    ],
    wing: { z: -2.02, y: 1.18, half: 0.8, depth: 0.4, thick: 0.1, stand: [0.52, -0.52], standH: 0.3, dark: false },
    exhaust: [0.3, -0.3],
    colors: [['Renaissance Red', 0xb3141c], ['Alpine White', 0xe9e9ec], ['Super Silver', 0xbfc3c9], ['Deep Blue', 0x1b2f7a], ['Lime Green', 0x4aa83a], ['Black', 0x17171b]],
    perf: { mass: 1510, hp: 325, red: 7000, drive: 'RWD', wf: 0.53, h: 0.52, mu: 1.12, cdA: 0.68, clA: 0.12, lag: 5, turbo: true, cyl: 6, snd: 'i6', lock: 0.6 },
  },
  {
    id: 'gtr', brand: 'Nissan', model: 'Skyline GT-R V-Spec', year: 1999, country: 'Japan',
    tagline: 'All-wheel-drive Godzilla',
    desc: 'ATTESA all-wheel drive shoves the power down on corner exit. The easiest car to drive fast, and the hardest to out-brake.',
    L: 4.60, W: 1.79, wb: 2.67,
    top: [[-2.3, .68], [-2.2, .88], [-1.7, .92], [-1.1, .90], [-0.6, .86], [0.4, .82], [1.3, .76], [2.0, .70], [2.3, .64]],
    half: [[-2.3, .72], [-2.05, .87], [-1.0, .89], [0.4, .89], [1.3, .89], [2.05, .86], [2.3, .74]],
    cab: { z0: -1.4, z1: 0.55, roof: [[-1.4, .90], [-1.0, 1.20], [-0.5, 1.34], [0.1, 1.35], [0.35, 1.28], [0.55, .82]], half: [[-1.4, .70], [-0.8, .78], [0.2, .77], [0.55, .70]] },
    paint: [
      { z: [2.05, 2.3], y: [.45, .62], ax: [.55, .88], c: 0xfff6c8 },
      { z: [-2.3, -2.1], y: [.65, .8], ax: [.5, .86], c: 0x9a1010 },
      { z: [-2.3, -2.1], y: [.65, .8], ax: [.18, .4], c: 0x9a1010 },
      { z: [2.15, 2.3], y: [.26, .42], ax: [0, .46], c: 0x111114 },
    ],
    wing: { z: -2.1, y: 1.12, half: 0.8, depth: 0.42, thick: 0.08, stand: [0.36, -0.36], standH: 0.22, dark: true },
    exhaust: [0.45, 0.25, -0.25, -0.45],
    colors: [['Bayside Blue', 0x1c3f9c], ['Midnight Purple', 0x4a2a7e], ['Sparkling Silver', 0xbfc3c9], ['White', 0xe9e9ec], ['Active Red', 0xb5161b], ['Black', 0x17171b]],
    perf: { mass: 1560, hp: 340, red: 7600, drive: 'AWD', wf: 0.55, h: 0.52, mu: 1.14, cdA: 0.74, clA: 0.15, lag: 5, turbo: true, cyl: 6, snd: 'i6', lock: 0.6 },
  },
  {
    id: '911', brand: 'Porsche', model: '911 GT3', year: 2022, country: 'Germany',
    tagline: 'Naturally aspirated precision',
    desc: 'A 9,000 rpm flat-six hanging behind the rear axle. Huge grip from wings and sticky rubber: brutally quick when you trust the rear.',
    L: 4.57, W: 1.85, wb: 2.46,
    top: [[-2.285, .66], [-2.2, .88], [-1.8, .96], [-1.3, .96], [-0.6, .88], [0.1, .80], [1.0, .80], [1.7, .76], [2.0, .72], [2.285, .64]],
    half: [[-2.285, .76], [-2.0, .92], [-1.2, .93], [-0.2, .88], [0.9, .88], [1.7, .90], [2.285, .78]],
    cab: { z0: -1.55, z1: 0.5, roof: [[-1.55, .92], [-1.05, 1.08], [-0.45, 1.22], [0.15, 1.30], [0.35, 1.24], [0.5, .80]], half: [[-1.55, .66], [-0.8, .78], [0.2, .78], [0.5, .70]] },
    paint: [
      { z: [1.9, 2.285], y: [.65, .8], ax: [.5, .8], c: 0xffffff },
      { z: [-2.285, -2.1], y: [.65, .8], ax: [0, .8], c: 0xa01010 },
      { z: [2.2, 2.285], y: [.26, .4], ax: [0, .6], c: 0x111114 },
    ],
    wing: { z: -2.12, y: 1.22, half: 0.86, depth: 0.42, thick: 0.07, stand: [0.55, -0.55], standH: 0.3, dark: true },
    exhaust: [0.4, -0.4],
    colors: [['GT Silver', 0xc6cacd], ['Guards Red', 0xd0121b], ['Racing Yellow', 0xf2cc12], ['Shark Blue', 0x2a62b0], ['Python Green', 0x3d8a4a], ['Black', 0x17171b]],
    perf: { mass: 1435, hp: 500, red: 9000, drive: 'RWD', wf: 0.39, h: 0.46, mu: 1.28, cdA: 0.66, clA: 1.10, lag: 25, turbo: false, cyl: 6, snd: 'flat6', lock: 0.6, aiGrip: 0.9 },
  },
  {
    id: 'f40', brand: 'Ferrari', model: 'F40', year: 1989, country: 'Italy',
    tagline: 'The last car Enzo approved',
    desc: 'Twin-turbo V8, no driver aids, no mercy. Explosive power past 4,000 rpm and a fierce, tail-happy temperament. Pure drama.',
    L: 4.36, W: 1.97, wb: 2.45,
    top: [[-2.18, .78], [-2.1, .90], [-1.6, .98], [-1.0, .96], [-0.5, .86], [0.4, .74], [1.4, .66], [1.9, .60], [2.18, .56]],
    half: [[-2.18, .80], [-1.9, .93], [-1.0, .99], [0.2, .96], [1.2, .97], [1.9, .90], [2.18, .78]],
    cab: { z0: -0.9, z1: 0.45, roof: [[-0.9, .96], [-0.55, 1.10], [-0.05, 1.12], [0.2, 1.08], [0.45, .72]], half: [[-0.9, .80], [-0.3, .86], [0.2, .85], [0.45, .76]] },
    louvers: { z0: -2.0, z1: -0.95, c: 0x101012 },
    paint: [
      { z: [1.7, 2.18], y: [.45, .62], ax: [.4, .8], c: 0xffffff },
      { z: [-2.18, -1.98], y: [.65, .82], ax: [.3, .68], c: 0x9a1010 },
      { z: [2.0, 2.18], y: [.15, .3], ax: [0, .6], c: 0x101012 },
      { z: [0.8, 1.3], y: [.4, .7], ax: [0, .22], c: 0x101012 },
    ],
    wing: { z: -2.08, y: 1.25, half: 0.95, depth: 0.5, thick: 0.1, stand: [0.62, -0.62], standH: 0.32, dark: false },
    exhaust: [0.25, -0.25],
    colors: [['Rosso Corsa', 0xc8102e], ['Giallo Modena', 0xf0cd1a], ['Nero', 0x17171b], ['Bianco Avus', 0xe9e9ec], ['Argento', 0xbfc3c9], ['Blu Tour de France', 0x1c3f9c]],
    perf: { mass: 1254, hp: 471, red: 7800, drive: 'RWD', wf: 0.42, h: 0.45, mu: 1.13, cdA: 0.64, clA: 0.35, lag: 2.6, turbo: true, cyl: 8, snd: 'v8', lock: 0.58, aiGrip: 0.86 },
  },
];

// ---- derived performance numbers ----
for (const s of CAR_SPECS) {
  const p = s.perf;
  const rho = 1.2;
  const P = p.hp * 745.7 * 0.9;
  p.topSpeed = Math.cbrt(2 * P / (rho * p.cdA)); // m/s (drag-limited)
  p.kmh = p.topSpeed * 3.6;
  p.pwr = p.hp / p.mass;
}

const tab = (t, z) => {
  if (z <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (z <= t[i][0]) { const a = t[i - 1], b = t[i]; return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]); }
  }
  return t[t.length - 1][1];
};

const GLASS = 0x18222e, GLASS2 = 0x22303f;

export function buildBodyVoxels(spec, bodyColor, stripe) {
  const m = new VoxelModel();
  const L = spec.L, W = spec.W;
  const floorH = 0.2;
  const hwMax = W / 2;
  const nz = Math.ceil(L / 2 / VS) + 1, nx = Math.ceil(hwMax / VS) + 1, ny = Math.ceil(1.5 / VS);
  const roofMax = Math.max(...spec.cab.roof.map((r) => r[1]));
  const wx = hwMax - 0.14; // wheel centre x
  const sill = 0x18181b;
  const bodyC = bodyColor;
  for (let iz = -nz; iz < nz; iz++) {
    const z = (iz + 0.5) * VS;
    if (Math.abs(z) > L / 2) continue;
    const hTop = tab(spec.top, z), hw = tab(spec.half, z);
    const inCab = z >= spec.cab.z0 && z <= spec.cab.z1;
    const roof = inCab ? tab(spec.cab.roof, z) : 0, cw = inCab ? tab(spec.cab.half, z) : 0;
    for (let iy = 0; iy < ny; iy++) {
      const y = (iy + 0.5) * VS;
      if (y < floorH) continue;
      for (let ix = -nx; ix < nx; ix++) {
        const x = (ix + 0.5) * VS, ax = Math.abs(x);
        if (ax > hw) continue;
        if (y <= hTop) {
          m.set(ix, iy, iz, y < 0.4 ? sill : bodyC);
        } else if (inCab && y <= roof && ax <= cw) {
          const isTop = y + VS > roof;
          const isSide = ax > cw - VS;
          const nearEnd = z - spec.cab.z0 < 0.16 || spec.cab.z1 - z < 0.1;
          let c;
          if (isTop) c = roof >= roofMax - 0.075 ? bodyC : GLASS2;
          else if (isSide) c = nearEnd ? bodyC : GLASS;
          else c = GLASS;
          m.set(ix, iy, iz, c);
        }
      }
    }
  }
  // wheel arches
  const wcs = [[wx, spec.wb / 2], [-wx, spec.wb / 2], [wx, -spec.wb / 2], [-wx, -spec.wb / 2]];
  const arR = 0.44;
  const toDel = [], toDark = [];
  m.forEach((ix, iy, iz) => {
    const x = (ix + 0.5) * VS, y = (iy + 0.5) * VS, z = (iz + 0.5) * VS;
    for (const [cx, cz] of wcs) {
      if (Math.sign(x) !== Math.sign(cx)) continue;
      const d2 = (z - cz) ** 2 + (y - WHEEL_R) ** 2;
      if (d2 < arR * arR) {
        const ax = Math.abs(x);
        if (ax > wx - 0.2) toDel.push([ix, iy, iz]);
        else if (ax > wx - 0.42) toDark.push([ix, iy, iz]);
      }
    }
  });
  for (const [a, b, c] of toDel) m.del(a, b, c);
  for (const [a, b, c] of toDark) m.set(a, b, c, 0x121214);
  // paint rects
  const paintRect = (r) => {
    m.forEach((ix, iy, iz, c) => {
      const x = Math.abs((ix + 0.5) * VS), y = (iy + 0.5) * VS, z = (iz + 0.5) * VS;
      if (z >= r.z[0] && z <= r.z[1] && y >= r.y[0] && y <= r.y[1] && x >= r.ax[0] && x <= r.ax[1]) m.set(ix, iy, iz, r.c);
    });
  };
  for (const r of spec.paint) paintRect(r);
  // louvers (F40 engine cover)
  if (spec.louvers) {
    const cells = [];
    m.forEach((ix, iy, iz, c) => {
      const x = Math.abs((ix + 0.5) * VS), z = (iz + 0.5) * VS;
      if (z >= spec.louvers.z0 && z <= spec.louvers.z1 && x < 0.62 && !m.has(ix, iy + 1, iz) && (iz & 1) === 0 && c === bodyC) cells.push([ix, iy, iz]);
    });
    for (const [a, b, c] of cells) m.set(a, b, c, spec.louvers.c);
  }
  // stripes
  if (stripe) {
    const sc = (bodyColor === 0xe9e9ec || bodyColor === 0xf0cd1a || bodyColor === 0xf0c020 || bodyColor === 0xf2cc12) ? 0x1a1a1e : 0xf1f1f1;
    const cells = [];
    m.forEach((ix, iy, iz, c) => {
      const x = Math.abs((ix + 0.5) * VS);
      if (c === bodyC && x > 0.1 && x < 0.3 && !m.has(ix, iy + 1, iz)) cells.push([ix, iy, iz]);
    });
    for (const [a, b, c] of cells) m.set(a, b, c, sc);
  }
  // wing
  const w = spec.wing;
  if (w) {
    const wc = w.dark ? 0x141416 : bodyC;
    const iy0 = Math.round(w.y / VS), th = Math.max(1, Math.round(w.thick / VS));
    for (let iz = Math.round((w.z - w.depth / 2) / VS); iz < Math.round((w.z + w.depth / 2) / VS); iz++)
      for (let ix = -Math.round(w.half / VS); ix < Math.round(w.half / VS); ix++)
        for (let t = 0; t < th; t++) m.set(ix, iy0 + t, iz, wc);
    // end plates
    for (const sx of [-Math.round(w.half / VS) - 1, Math.round(w.half / VS)])
      for (let iz = Math.round((w.z - w.depth / 2) / VS); iz < Math.round((w.z + w.depth / 2) / VS); iz++)
        for (let t = -1; t < th + 1; t++) m.set(sx, iy0 + t, iz, 0x101012);
    for (const sx of w.stand) {
      const ix = Math.round(sx / VS) - (sx > 0 ? 0 : 1);
      for (let iy = Math.round((w.y - w.standH) / VS); iy < iy0; iy++) m.set(ix, iy, Math.round(w.z / VS), 0x101012);
    }
  }
  // mirrors
  {
    const iz = Math.round((spec.cab.z1 - 0.18) / VS);
    const bel = tab(spec.top, spec.cab.z1 - 0.18);
    const iy = Math.round(bel / VS);
    const hwm = tab(spec.half, spec.cab.z1 - 0.18);
    const ix = Math.round(hwm / VS) - 1;
    for (const sx of [ix + 1, -(ix + 2)]) m.set(sx, iy, iz, bodyC);
  }
  // exhausts
  for (const ex of spec.exhaust || []) {
    const ix = Math.round(ex / VS) - (ex > 0 ? 0 : 1);
    const iz = Math.floor((-L / 2) / VS) - 1;
    m.set(ix, 1, iz + 1, 0xb9bec6);
  }
  // front splitter & rear diffuser dark lip
  return m;
}

let wheelGeo = null;
function getWheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const m = new VoxelModel();
  const R = WHEEL_R / WVS;
  const rimR = R * 0.62;
  for (let iy = -4; iy <= 3; iy++) for (let iz = -4; iz <= 3; iz++) {
    const dy = iy + 0.5, dz = iz + 0.5, d = Math.hypot(dy, dz);
    if (d > R + 0.15) continue;
    const ang = Math.atan2(dy, dz);
    const sector = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 10) & 1;
    for (let ix = -1; ix <= 1; ix++) {
      let c = 0x1a1a1c;
      if (d < rimR) c = d < 0.9 ? 0x2a2a2e : (sector ? 0xd0d4da : 0x74787f);
      else if (d < rimR + 0.9) c = 0x2a2a2c;
      m.set(ix, iy, iz, c);
    }
  }
  wheelGeo = m.toGeometry(WVS, [0, 0, 0], true);
  return wheelGeo;
}

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const brakeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const lightMatOn = new THREE.MeshBasicMaterial({ color: 0xffffff });

const geoCache = new Map();
export function getBodyGeometry(spec, color, stripe) {
  const key = `${spec.id}:${color}:${stripe ? 1 : 0}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const m = buildBodyVoxels(spec, color, stripe);
  const g = m.toGeometry(VS, [0, 0, 0], true);
  geoCache.set(key, g);
  return g;
}

/** Returns a Group with .userData { chassis, wheels:[FL,FR,RL,RR], brake, spec } */
export function createCarObject(spec, color, stripe = false, opts = {}) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const body = new THREE.Mesh(getBodyGeometry(spec, color, stripe), opts.material || bodyMat);
  body.castShadow = true;
  chassis.add(body);
  const wx = spec.W / 2 - 0.14;
  const wheels = [];
  const wgeo = getWheelGeometry();
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, WHEEL_R, sz * spec.wb / 2);
    const spin = new THREE.Group();
    const wm = new THREE.Mesh(wgeo, opts.material || bodyMat);
    wm.castShadow = true;
    spin.add(wm);
    pivot.add(spin);
    chassis.add(pivot);
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  // brake lights
  const brake = new THREE.Group();
  for (const r of spec.paint) {
    if (r.z[1] < -1) {
      for (const sx of [1, -1]) {
        const bx = (r.ax[1] - r.ax[0]) , by = r.y[1] - r.y[0];
        const b = new THREE.Mesh(new THREE.BoxGeometry(bx, by, 0.05), brakeMat);
        b.position.set(sx * (r.ax[0] + r.ax[1]) / 2, (r.y[0] + r.y[1]) / 2, -spec.L / 2 - 0.02);
        brake.add(b);
      }
    }
  }
  brake.visible = false;
  chassis.add(brake);
  root.userData = { chassis, wheels, brake, spec, body };
  return root;
}

export function carStats() {
  const maxPwr = Math.max(...CAR_SPECS.map((c) => c.perf.pwr));
  const maxV = Math.max(...CAR_SPECS.map((c) => c.perf.kmh));
  return CAR_SPECS.map((c) => {
    const p = c.perf;
    const grip = p.mu * (1 + p.clA * 0.12) * (p.drive === 'AWD' ? 1.05 : 1);
    return {
      id: c.id,
      power: p.pwr / maxPwr,
      speed: p.kmh / maxV,
      grip: (grip - 1.0) / 0.45,
      accel: (p.pwr / maxPwr) * (p.drive === 'AWD' ? 1.08 : 1) * 0.9,
    };
  });
}
