// Voxel world generation for a track: terrain columns, kerbs, barriers, bridge deck, trees, stands, sky.
import * as THREE from '../vendor/three.module.js';
import { VoxelModel, meshColumnGrid } from './voxel.js';
import { hash2, clamp, lerp, smooth } from './trackgen.js';

const FLOOR = -70;
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mulc = (c, f) => [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const CROWD = [0xd33a3a, 0x3a6fd3, 0xe8d23a, 0xf0f0f0, 0x3ab36a, 0xe07a2a, 0x8a4ad3, 0x222a33];

function makeTreeGeometry(kind, leafCols, trunkCol) {
  const m = new VoxelModel();
  const T = trunkCol, L = leafCols;
  const box = (y, r, col, cut = false) => {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (cut && Math.abs(x) === r && Math.abs(z) === r) continue;
      m.set(x, y, z, col);
    }
  };
  if (kind === 'conifer') {
    m.set(0, 0, 0, T); m.set(0, 1, 0, T);
    box(1, 2, L[1], true); box(2, 2, L[0], true); box(3, 1, L[2]); box(4, 1, L[1], true); box(5, 0, L[0]); box(6, 0, L[2]);
  } else if (kind === 'oak') {
    m.set(0, 0, 0, T); m.set(0, 1, 0, T); m.set(0, 2, 0, T);
    box(2, 3, L[1], true); box(3, 3, L[0], true); box(4, 2, L[2], true);
  } else {
    m.set(0, 0, 0, T); m.set(0, 1, 0, T);
    box(2, 2, L[1], true); box(3, 2, L[0]); box(4, 1, L[2]);
  }
  return m.toGeometry(0.9, [0, 0, 0], false);
}

function bannerTexture(text, bg, fg = '#ffffff', w = 512, h = 64) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < w; i += 32) g.fillRect(i, 0, 16, h);
  g.fillStyle = fg; g.font = 'bold 40px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(track, opts = {}) {
  const theme = track.meta.theme;
  const { N, X, Z, Y, NX, NZ, ds, L, hw } = track;
  const group = new THREE.Group();
  const disposables = [];
  const tStart = performance.now();

  // ------------------------------------------------------------------ fine grid
  const BLOCK = 8, R = Math.ceil(hw + 16), R2 = R * R;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }
  const ox = Math.floor((minX - R - 4) / BLOCK) * BLOCK, oz = Math.floor((minZ - R - 4) / BLOCK) * BLOCK;
  const nx = Math.ceil((maxX + R + 4 - ox) / BLOCK) * BLOCK, nz = Math.ceil((maxZ + R + 4 - oz) / BLOCK) * BLOCK;
  const dist = new Float32Array(nx * nz).fill(1e9);
  const near = new Int32Array(nx * nz).fill(-1);
  const stamp = (px, pz, i) => {
    const cx0 = Math.max(0, Math.floor(px - R - ox)), cx1 = Math.min(nx - 1, Math.ceil(px + R - ox));
    const cz0 = Math.max(0, Math.floor(pz - R - oz)), cz1 = Math.min(nz - 1, Math.ceil(pz + R - oz));
    for (let cz = cz0; cz <= cz1; cz++) {
      const dz = oz + cz + 0.5 - pz, dz2 = dz * dz;
      let ci = cz * nx + cx0;
      for (let cx = cx0; cx <= cx1; cx++, ci++) {
        const dx = ox + cx + 0.5 - px;
        const d2 = dx * dx + dz2;
        if (d2 < dist[ci] && d2 < R2) { dist[ci] = d2; near[ci] = i; }
      }
    }
  };
  for (let i = 0; i < N; i++) {
    if (track.bridge[i]) continue;
    const j = (i + 1) % N;
    stamp(X[i], Z[i], i);
    stamp((X[i] + X[j]) * 0.5, (Z[i] + Z[j]) * 0.5, i);
  }
  const bnx = nx / BLOCK, bnz = nz / BLOCK;
  const marked = new Uint8Array(bnx * bnz);
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) if (near[cz * nx + cx] >= 0) marked[((cz / BLOCK) | 0) * bnx + ((cx / BLOCK) | 0)] = 1;

  const topF = new Float32Array(nx * nz).fill(NaN);
  const rgbF = new Uint8Array(nx * nz * 3);
  const G = rgb(theme.grass), GA = rgb(theme.grassAlt), RD = rgb(theme.road), HL = rgb(theme.hill);
  const WH = [236, 236, 238], RED = [200, 40, 40], BLK = [28, 28, 32];
  const zones = [];
  for (const lm of theme.landmarks || []) if (lm.type === 'stand' || lm.type === 'pit') zones.push({ type: lm.type, s0: lm.frac * L, len: lm.len, side: lm.side });
  const trees = [];
  const q = (v, k) => Math.round(v * k) / k;
  const tr = theme.trees;
  const tmpFar = { h: 0, dmin: 0 };

  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      const ci = cz * nx + cx;
      const blk = ((cz / BLOCK) | 0) * bnx + ((cx / BLOCK) | 0);
      if (!marked[blk]) continue;
      const wx = ox + cx + 0.5, wz = oz + cz + 0.5;
      const ni = near[ci];
      const hsh = hash2(cx, cz);
      let top, col;
      if (ni < 0) {
        const f = track.farHeight(wx, wz);
        top = q(f.h, 2);
        col = hillColor(f.h, hsh, G, GA, HL, theme);
      } else {
        const d = Math.sqrt(dist[ci]);
        const yn = Y[ni];
        const off = (wx - X[ni]) * NX[ni] + (wz - Z[ni]) * NZ[ni];
        const s = ni * ds;
        let far = yn;
        if (d > hw + 3.5) far = track.farHeight(wx, wz).h;
        top = q(track.terrainTop(d, yn, far), 4);
        const wall = track.wallD[ni];
        if (d <= hw) {
          // road
          let c = mulc(RD, 0.94 + hsh * 0.12);
          if (Math.abs(off - track.ROFF[ni]) < 1.5) c = mulc(c, 0.9);
          if (d > hw - 0.85) c = WH;
          else if (Math.abs(off) < 0.4 && (Math.floor(s / 5) & 1) === 0) c = [220, 220, 220];
          // start / finish line
          const sd = ((s + L / 2) % L) - L / 2;
          if (sd >= -1 && sd < 1.5) c = ((Math.floor(off) + Math.floor(sd * 1.0)) & 1) ? WH : BLK;
          col = c;
        } else if (d <= hw + 1.3 && track.kerb[ni]) {
          col = (Math.floor(s / 2.5) & 1) ? RED : WH;
        } else if (d >= wall && d < wall + 1.2) {
          // barrier
          top = q(track.terrainTop(d, yn, far), 4) + 1.2;
          col = (Math.floor(s / 5) & 1) ? [225, 225, 228] : [196, 52, 48];
          if (Math.abs(((s / 5) % 1) - 0.5) > 0.45) col = [90, 90, 96];
        } else {
          col = mulc(((cx + cz) & 8) ? G : GA, 0.93 + hsh * 0.14);
          if (d < hw + 3.6 && d > hw + 1.3) col = mulc(col, 1.06);
          // zones (grandstand / pit building)
          let used = false;
          if (d >= wall + 1.2 + 1.5 && zones.length) {
            for (const z of zones) {
              let sd = s - z.s0; sd -= Math.round(sd / L) * L;
              if (Math.abs(sd) < z.len / 2 && Math.sign(off) === z.side) {
                if (z.type === 'stand') {
                  const r = Math.floor(d - (wall + 2.2));
                  if (r >= 0 && r < 7) {
                    top = q(track.terrainTop(d, yn, far), 4) + 1.3 + r * 1.2;
                    col = hash2(cx * 7, cz * 13) < 0.62 ? rgb(CROWD[(hash2(cx, cz * 3) * CROWD.length) | 0]) : [70, 74, 84];
                    if (r === 6) col = [210, 212, 218];
                    used = true;
                  }
                } else if (z.type === 'pit') {
                  const r = d - (wall + 2.5);
                  if (r >= 0 && r < 6) {
                    top = q(track.terrainTop(d, yn, far), 4) + (r > 5 ? 3 : 4.5);
                    col = (Math.floor(s / 12) & 1) ? [226, 228, 232] : [196, 200, 208];
                    if (r < 1) col = [60, 80, 140];
                    used = true;
                  }
                }
              }
            }
          }
          // trees on rows just outside the barrier
          if (!used && tr && d > wall + 2.5 && d < R - 0.5 && hsh < tr.density * 0.5 && hash2(cx + 91, cz + 17) < 0.9) {
            trees.push([wx + (hsh * 40 % 1 - 0.5) * 0.6, top, wz + (hash2(cx, cz + 5) - 0.5) * 0.6, hash2(cx + 3, cz + 7)]);
          }
        }
      }
      topF[ci] = top;
      rgbF[ci * 3] = col[0]; rgbF[ci * 3 + 1] = col[1]; rgbF[ci * 3 + 2] = col[2];
    }
  }

  // ------------------------------------------------------------------ coarse terrain
  const CS = 8, MARGIN = 70; // coarse cells of margin each side (560 m)
  const cnx = nx / BLOCK + MARGIN * 2, cnz = nz / BLOCK + MARGIN * 2;
  const cox = ox - MARGIN * CS, coz = oz - MARGIN * CS;
  const topC = new Float32Array(cnx * cnz).fill(NaN);
  const rgbC = new Uint8Array(cnx * cnz * 3);
  const coarseTopAt = (wx, wz) => {
    const ix = Math.floor((wx - cox) / CS), iz = Math.floor((wz - coz) / CS);
    if (ix < 0 || iz < 0 || ix >= cnx || iz >= cnz) return FLOOR;
    const t = topC[iz * cnx + ix];
    return t !== t ? FLOOR : t;
  };
  const coarseTrees = [];
  for (let iz = 0; iz < cnz; iz++) {
    for (let ix = 0; ix < cnx; ix++) {
      const bx = ix - MARGIN, bz = iz - MARGIN;
      if (bx >= 0 && bz >= 0 && bx < bnx && bz < bnz && marked[bz * bnx + bx]) continue;
      const wx = cox + (ix + 0.5) * CS, wz = coz + (iz + 0.5) * CS;
      const f = track.farHeight(wx, wz);
      const h = q(f.h, 2);
      const ci = iz * cnx + ix;
      topC[ci] = h;
      const c = hillColor(f.h, hash2(ix, iz), G, GA, HL, theme);
      rgbC[ci * 3] = c[0]; rgbC[ci * 3 + 1] = c[1]; rgbC[ci * 3 + 2] = c[2];
      if (tr && f.dmin > 30 && f.dmin < 500 && hash2(ix + 5, iz + 9) < tr.density * 0.3) {
        coarseTrees.push([wx + (hash2(ix, iz + 1) - 0.5) * 6, h, wz + (hash2(ix + 2, iz) - 0.5) * 6, hash2(ix + 3, iz + 3)]);
      }
    }
  }

  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(terrainMat);
  {
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.grass).multiplyScalar(0.8) }));
    gp.rotation.x = -Math.PI / 2; gp.position.set((minX + maxX) / 2, -0.7, (minZ + maxZ) / 2);
    disposables.push(gp.geometry, gp.material);
    group.add(gp);
  }
  const fineMeshes = meshColumnGrid({ nx, nz, ox, oz, cs: 1, top: topF, rgb: rgbF, floor: FLOOR, outsideTop: coarseTopAt }, terrainMat, 48);
  const coarseMeshes = meshColumnGrid({ nx: cnx, nz: cnz, ox: cox, oz: coz, cs: CS, top: topC, rgb: rgbC, floor: FLOOR, outsideTop: () => FLOOR }, terrainMat, 40);
  for (const m of fineMeshes) group.add(m);
  for (const m of coarseMeshes) group.add(m);

  // ------------------------------------------------------------------ bridge deck
  let bridgeCount = 0;
  for (let i = 0; i < N; i++) bridgeCount += track.bridge[i];
  if (bridgeCount > 0) {
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (let i = 0; i < N; i++) if (track.bridge[i]) { bx0 = Math.min(bx0, X[i]); bx1 = Math.max(bx1, X[i]); bz0 = Math.min(bz0, Z[i]); bz1 = Math.max(bz1, Z[i]); }
    const pad = hw + 4;
    const dox = Math.floor(bx0 - pad), doz = Math.floor(bz0 - pad);
    const dnx = Math.ceil(bx1 + pad - dox), dnz = Math.ceil(bz1 + pad - doz);
    const dTop = new Float32Array(dnx * dnz).fill(NaN), dBase = new Float32Array(dnx * dnz), dRgb = new Uint8Array(dnx * dnz * 3);
    const dDist = new Float32Array(dnx * dnz).fill(1e9), dNear = new Int32Array(dnx * dnz).fill(-1);
    const DR = hw + 1.2;
    for (let i = 0; i < N; i++) {
      if (!track.bridge[i]) continue;
      for (const sub of [0, 0.5]) {
        const j = (i + 1) % N;
        const px = X[i] + (X[j] - X[i]) * sub, pz = Z[i] + (Z[j] - Z[i]) * sub;
        for (let cz = Math.max(0, Math.floor(pz - DR - doz)); cz <= Math.min(dnz - 1, Math.ceil(pz + DR - doz)); cz++)
          for (let cx = Math.max(0, Math.floor(px - DR - dox)); cx <= Math.min(dnx - 1, Math.ceil(px + DR - dox)); cx++) {
            const dx = dox + cx + 0.5 - px, dz = doz + cz + 0.5 - pz, d2 = dx * dx + dz * dz;
            const ci = cz * dnx + cx;
            if (d2 < DR * DR && d2 < dDist[ci]) { dDist[ci] = d2; dNear[ci] = i; }
          }
      }
    }
    const piers = [];
    for (let cz = 0; cz < dnz; cz++) for (let cx = 0; cx < dnx; cx++) {
      const ci = cz * dnx + cx, ni = dNear[ci];
      if (ni < 0) continue;
      const wx = dox + cx + 0.5, wz = doz + cz + 0.5;
      const d = Math.sqrt(dDist[ci]);
      const off = (wx - X[ni]) * NX[ni] + (wz - Z[ni]) * NZ[ni];
      const y = q(Y[ni], 4);
      let c;
      if (d > hw) { dTop[ci] = y + 1.1; c = (Math.floor(ni * ds / 4) & 1) ? [225, 225, 228] : [180, 184, 192]; }
      else {
        dTop[ci] = y;
        c = mulc(RD, 0.95 + hash2(cx, cz) * 0.1);
        if (d > hw - 0.85) c = WH; else if (Math.abs(off) < 0.4 && (Math.floor(ni * ds / 5) & 1) === 0) c = [220, 220, 220];
      }
      dBase[ci] = y - 1.3;
      dRgb[ci * 3] = c[0]; dRgb[ci * 3 + 1] = c[1]; dRgb[ci * 3 + 2] = c[2];
      // piers
      if (d > hw - 2.6 && d <= hw - 0.6 && (ni % 22) < 2) piers.push(ci);
    }
    for (const ci of piers) {
      const cx = ci % dnx, cz = (ci / dnx) | 0;
      const wx = dox + cx + 0.5, wz = doz + cz + 0.5;
      // ground below?
      const fx = Math.floor(wx - ox), fz = Math.floor(wz - oz);
      let g = FLOOR;
      if (fx >= 0 && fz >= 0 && fx < nx && fz < nz) { const t = topF[fz * nx + fx]; if (t === t) g = t; }
      if (g === FLOOR) g = track.farHeight(wx, wz).h;
      // skip if another road is right under it
      if (fx >= 0 && fz >= 0 && fx < nx && fz < nz && dist[fz * nx + fx] < (hw + 2) * (hw + 2) && Math.abs(Y[near[fz * nx + fx]] - dTop[ci]) > 3) continue;
      dBase[ci] = g - 1;
      dRgb[ci * 3] = 150; dRgb[ci * 3 + 1] = 152; dRgb[ci * 3 + 2] = 158;
    }
    const deckMeshes = meshColumnGrid({ nx: dnx, nz: dnz, ox: dox, oz: doz, cs: 1, top: dTop, base: dBase, rgb: dRgb, floor: FLOOR, outsideTop: () => -1e9 }, terrainMat, 64);
    for (const m of deckMeshes) { m.receiveShadow = true; group.add(m); }
  }

  // ------------------------------------------------------------------ trees
  const allTrees = trees.concat(coarseTrees);
  if (tr && allTrees.length) {
    const geo = makeTreeGeometry(tr.kind, tr.leaf, tr.trunk);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    disposables.push(geo, mat);
    const buckets = new Map();
    for (const t of allTrees) {
      const k = Math.floor(t[0] / 140) * 100003 + Math.floor(t[2] / 140);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
    const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const list of buckets.values()) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        const sc = 0.8 + t[3] * 0.9;
        qt.setFromAxisAngle(up, Math.floor(t[3] * 4) * Math.PI / 2);
        pv.set(t[0], t[1] - 0.1, t[2]); sv.set(sc, sc * (0.9 + t[3] * 0.4), sc);
        mtx.compose(pv, qt, sv); inst.setMatrixAt(i, mtx);
        const v = 0.8 + ((t[3] * 977) % 1) * 0.4;
        col.setRGB(v, v, v); inst.setColorAt(i, col);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }

  // ------------------------------------------------------------------ gantry + banners + landmarks
  const dynamic = { ferris: null, clouds: null, sky: null };
  if (typeof document !== 'undefined') {
    const p0 = track.pose(0, 0);
    const gantry = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
    const w = hw + 2.2;
    for (const sx of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), steel);
      pil.position.set(sx * w, 4.5, 0); gantry.add(pil);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1.4, 2.4, 1.2), steel);
    bar.position.set(0, 9.2, 0); gantry.add(bar);
    const tex = bannerTexture('VOXEL GT  ·  ' + track.meta.short.toUpperCase(), '#c8102e', '#ffffff', 1024, 96);
    const bm = new THREE.MeshBasicMaterial({ map: tex });
    disposables.push(tex, bm, steel);
    for (const sz of [0.62, -0.62]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 2.2), bm);
      b.position.set(0, 9.2, sz); if (sz < 0) b.rotation.y = Math.PI; gantry.add(b);
    }
    // start lights
    gantry.position.set(p0.x, p0.y, p0.z);
    gantry.rotation.y = p0.psi;
    group.add(gantry);

    // sponsor boards along barriers
    const banners = (theme.sponsors || []).map((t, i) => bannerTexture(t, ['#0b4ea2', '#d4141c', '#10803a', '#222a33'][i % 4]));
    banners.forEach((t) => disposables.push(t));
    const boardGeo = new THREE.PlaneGeometry(14, 1.8);
    disposables.push(boardGeo);
    const mats = banners.map((t) => { const m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }); disposables.push(m); return m; });
    let bi = 0;
    for (let s = 40; s < L; s += 85) {
      const i = Math.round(s / ds) % N;
      if (track.bridge[i]) continue;
      const side = (bi % 2) ? 1 : -1;
      const lat = side * (track.wallD[i] + 1.6);
      const k = Math.abs(track.K[i]);
      // skip boards in tight corners (they'd be on the outside of nothing)
      const b = new THREE.Mesh(boardGeo, mats[bi % mats.length]);
      const tdx = track.TX[i], tdz = track.TZ[i];
      b.position.set(X[i] + NX[i] * lat, Y[i] - 0.25 + 1.5, Z[i] + NZ[i] * lat);
      // Face: normal should point toward track centre: normal = -side * N. A plane's +z normal rotated by yaw r => (sin r, cos r).
      const nxn = -side * NX[i], nzn = -side * NZ[i];
      b.rotation.y = Math.atan2(nxn, nzn);
      if (k < 1 / 60) { group.add(b); bi++; }
    }

    // landmarks
    for (const lm of theme.landmarks || []) {
      if (lm.type === 'ferris') {
        const p = track.pose(lm.frac * L, lm.lat);
        const f = track.farHeight(p.x, p.z);
        const g = new THREE.Group();
        const cm = new VoxelModel();
        const Rw = 26 / 1.2;
        const cols = [0xe8403a, 0xf0c63a, 0x3a9ae8, 0x5ac45a, 0xf2f2f2, 0xe87abc];
        for (let a = 0; a < 40; a++) {
          const ang = (a / 40) * Math.PI * 2;
          const y = Math.round(Math.sin(ang) * Rw), z = Math.round(Math.cos(ang) * Rw);
          for (let t = -1; t <= 0; t++) { cm.set(t, y, z, 0xf2f2f6); }
        }
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          for (let r = 1; r < Rw; r++) cm.set(0, Math.round(Math.sin(ang) * r), Math.round(Math.cos(ang) * r), 0xcfd3dc);
        }
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const y = Math.round(Math.sin(ang) * (Rw + 1)), z = Math.round(Math.cos(ang) * (Rw + 1));
          for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) for (let t = -1; t <= 1; t++) cm.set(t, y - dy, z + dz, cols[a % cols.length]);
        }
        const geo = cm.toGeometry(1.2, [0, 0, 0], false);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        disposables.push(geo, mesh.material);
        const wheel = new THREE.Group(); wheel.add(mesh);
        wheel.position.y = 34;
        g.add(wheel);
        // legs
        const legM = new THREE.MeshLambertMaterial({ color: 0xdfe3ea }); disposables.push(legM);
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 36, 1.6), legM);
          leg.position.set(0, 16, sz * 8); leg.rotation.x = -sz * 0.22; g.add(leg);
        }
        g.position.set(p.x, f.h - 1, p.z);
        g.rotation.y = p.psi + Math.PI / 2;
        group.add(g);
        dynamic.ferris = wheel;
      }
    }
  }

  // ------------------------------------------------------------------ distant mountains
  {
    const mm = new VoxelModel();
    const mcol = theme.mountains;
    const rnd = (a, b) => a + hash2(a * 13 + b, b * 7) ;
    // a single mountain shape, instanced around the horizon
    for (let layer = 0; layer < 12; layer++) {
      const r = 12 - layer;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        const k = layer > 8 ? 0xf2f6fb : mcol;
        mm.set(x, layer, z, layer > 8 ? 0xf2f6fb : (layer < 3 ? mixHex(mcol, 0x6b8a5a, 0.5) : mcol));
      }
    }
    const geo = mm.toGeometry(1, [0, 0, 0], false);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    disposables.push(geo, mat);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const count = 34;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + hash2(i, 3) * 0.3;
      const rad = 1500 + hash2(i, 9) * 500;
      const sc = 14 + hash2(i, 5) * 22;
      pv.set(cx + Math.cos(a) * rad, -8, cz + Math.sin(a) * rad);
      sv.set(sc * (1 + hash2(i, 1) * 0.6), sc * (0.7 + hash2(i, 2) * 0.9), sc * (1 + hash2(i, 4) * 0.6));
      mtx.compose(pv, qt, sv); inst.setMatrixAt(i, mtx);
    }
    inst.frustumCulled = false;
    group.add(inst);
  }

  // ------------------------------------------------------------------ sky + clouds
  {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3400, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(theme.skyTop) }, hor: { value: new THREE.Color(theme.skyHorizon) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.05,0.0,1.0); vec3 c = mix(hor, top, pow(h,0.7)); gl_FragColor = vec4(c,1.0); }',
      }));
    sky.renderOrder = -10;
    disposables.push(sky.geometry, sky.material);
    group.add(sky);
    dynamic.sky = sky;
    const cm = new VoxelModel();
    for (let x = -4; x <= 4; x++) for (let z = -2; z <= 2; z++) { if (Math.abs(x) + Math.abs(z) * 2 < 7) { cm.set(x, 0, z, 0xffffff); if (Math.abs(x) < 3 && Math.abs(z) < 2) cm.set(x, 1, z, 0xffffff); } }
    const geo = cm.toGeometry(10, [0, 0, 0], false);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 });
    disposables.push(geo, mat);
    const cnt = 46;
    const inst = new THREE.InstancedMesh(geo, mat, cnt);
    const mtx = new THREE.Matrix4(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), qt = new THREE.Quaternion();
    const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
    for (let i = 0; i < cnt; i++) {
      pv.set(cxm + (hash2(i, 31) - 0.5) * 4200, 380 + hash2(i, 32) * 140, czm + (hash2(i, 33) - 0.5) * 4200);
      const sc = 1 + hash2(i, 34) * 2.2; sv.set(sc * 1.6, 1, sc);
      mtx.compose(pv, qt, sv); inst.setMatrixAt(i, mtx);
    }
    inst.frustumCulled = false;
    group.add(inst);
    dynamic.clouds = inst;
  }

  group.userData.buildMs = performance.now() - tStart;
  group.userData.trees = allTrees.length;

  function update(camPos, t) {
    if (dynamic.sky) dynamic.sky.position.copy(camPos);
    if (dynamic.ferris) dynamic.ferris.rotation.x = t * 0.05;
    if (dynamic.clouds) dynamic.clouds.position.x = (t * 2.5) % 600 - 300;
  }
  function dispose() {
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const d of disposables) d.dispose && d.dispose();
  }
  return { group, update, dispose, bounds: { minX, maxX, minZ, maxZ } };
}

function mixHex(a, b, t) {
  const A = rgb(a), B = rgb(b), c = mixc(A, B, t);
  return (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
}

function hillColor(h, hsh, G, GA, HL, theme) {
  let c = mixc(G, HL, clamp(h / (theme.hillAmp * 0.9 + 1), 0, 1) * 0.8);
  if (hsh < 0.5) c = mixc(c, GA, 0.45);
  if (h > theme.hillAmp * 0.8) c = mixc(c, [150, 148, 140], 0.35);
  return mulc(c, 0.9 + hsh * 0.2);
}
