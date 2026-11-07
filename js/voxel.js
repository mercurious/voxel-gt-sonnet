// Voxel geometry helpers: (1) VoxelModel -> merged, face-culled, AO-shaded mesh (cars, props)
//                         (2) meshColumnGrid -> chunked height-column terrain meshes
import * as THREE from '../vendor/three.module.js';

// sRGB byte -> linear float LUT (vertex colours are interpreted as linear by three)
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export const lin = (b) => LIN[b & 255];

const AO_LEVELS = [0.52, 0.68, 0.84, 1.0];

const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export class VoxelModel {
  constructor() { this.cells = new Map(); }
  static key(x, y, z) { return (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576; }
  set(x, y, z, c) { this.cells.set(VoxelModel.key(x, y, z), c); }
  get(x, y, z) { return this.cells.get(VoxelModel.key(x, y, z)); }
  has(x, y, z) { return this.cells.has(VoxelModel.key(x, y, z)); }
  del(x, y, z) { this.cells.delete(VoxelModel.key(x, y, z)); }
  forEach(fn) {
    for (const [k, c] of this.cells) {
      const x = (k % 1024) - 512;
      const y = (Math.floor(k / 1024) % 1024) - 512;
      const z = Math.floor(k / 1048576) - 512;
      fn(x, y, z, c);
    }
  }

  /** Build geometry. size = voxel edge in metres; origin = metres offset subtracted from cell centres. */
  toGeometry(size, origin = [0, 0, 0], useAO = true) {
    const pos = [], col = [], nor = [], idx = [];
    const tmp = new THREE.Color();
    this.forEach((x, y, z, c) => {
      tmp.setHex(c);
      for (const f of FACES) {
        const [nx, ny, nz] = f.n;
        if (this.has(x + nx, y + ny, z + nz)) continue;
        const ao = [0, 0, 0, 0];
        if (useAO) {
          for (let k = 0; k < 4; k++) {
            const [a, b] = CORNERS[k];
            const s1 = this.has(x + nx + a * f.u[0], y + ny + a * f.u[1], z + nz + a * f.u[2]) ? 1 : 0;
            const s2 = this.has(x + nx + b * f.v[0], y + ny + b * f.v[1], z + nz + b * f.v[2]) ? 1 : 0;
            const cc = this.has(x + nx + a * f.u[0] + b * f.v[0], y + ny + a * f.u[1] + b * f.v[1], z + nz + a * f.u[2] + b * f.v[2]) ? 1 : 0;
            ao[k] = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
          }
        } else ao[0] = ao[1] = ao[2] = ao[3] = 3;
        const base = pos.length / 3;
        for (let k = 0; k < 4; k++) {
          const [a, b] = CORNERS[k];
          pos.push(
            ((x + 0.5 + 0.5 * (nx + a * f.u[0] + b * f.v[0])) * size) - origin[0],
            ((y + 0.5 + 0.5 * (ny + a * f.u[1] + b * f.v[1])) * size) - origin[1],
            ((z + 0.5 + 0.5 * (nz + a * f.u[2] + b * f.v[2])) * size) - origin[2]);
          nor.push(nx, ny, nz);
          const sh = AO_LEVELS[ao[k]];
          col.push(tmp.r * sh, tmp.g * sh, tmp.b * sh);
        }
        if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Chunked meshing of a height-column grid.
 * g = { nx, nz, ox, oz, cs, top:Float32Array(NaN=absent), rgb:Uint8Array(3/cell), base?:Float32Array,
 *       floor:number, outsideTop(wx,wz):number }
 * Returns array of THREE.Mesh (vertex coloured, Lambert).
 */
export function meshColumnGrid(g, material, chunk = 48) {
  const meshes = [];
  const { nx, nz, ox, oz, cs, top, rgb } = g;
  const hasBase = !!g.base;
  const topAt = (ix, iz, wx, wz) => {
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return g.outsideTop(wx, wz);
    const t = top[iz * nx + ix];
    return t !== t ? g.outsideTop(wx, wz) : t;
  };
  for (let cz0 = 0; cz0 < nz; cz0 += chunk) {
    for (let cx0 = 0; cx0 < nx; cx0 += chunk) {
      const pos = [], col = [], nor = [], idx = [];
      const cx1 = Math.min(nx, cx0 + chunk), cz1 = Math.min(nz, cz0 + chunk);
      const quad = (a, b, c, d, nxn, nyn, nzn, r, gg, bb) => {
        const base = pos.length / 3;
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        for (let k = 0; k < 4; k++) { nor.push(nxn, nyn, nzn); col.push(r, gg, bb); }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (let iz = cz0; iz < cz1; iz++) {
        for (let ix = cx0; ix < cx1; ix++) {
          const ci = iz * nx + ix;
          const t = top[ci];
          if (t !== t) continue;
          const x0 = ox + ix * cs, z0 = oz + iz * cs, x1 = x0 + cs, z1 = z0 + cs;
          const r = lin(rgb[ci * 3]), gg = lin(rgb[ci * 3 + 1]), bb = lin(rgb[ci * 3 + 2]);
          const bot = hasBase ? g.base[ci] : g.floor;
          // top
          quad([x0, t, z0], [x0, t, z1], [x1, t, z1], [x1, t, z0], 0, 1, 0, r, gg, bb);
          if (hasBase) quad([x0, bot, z0], [x1, bot, z0], [x1, bot, z1], [x0, bot, z1], 0, -1, 0, r * 0.6, gg * 0.6, bb * 0.6);
          // sides
          let nt = topAt(ix + 1, iz, x1 + cs * 0.5, z0 + cs * 0.5);
          let y0 = Math.max(nt, bot);
          if (y0 < t) quad([x1, y0, z0], [x1, t, z0], [x1, t, z1], [x1, y0, z1], 1, 0, 0, r, gg, bb);
          nt = topAt(ix - 1, iz, x0 - cs * 0.5, z0 + cs * 0.5); y0 = Math.max(nt, bot);
          if (y0 < t) quad([x0, y0, z1], [x0, t, z1], [x0, t, z0], [x0, y0, z0], -1, 0, 0, r, gg, bb);
          nt = topAt(ix, iz + 1, x0 + cs * 0.5, z1 + cs * 0.5); y0 = Math.max(nt, bot);
          if (y0 < t) quad([x1, y0, z1], [x1, t, z1], [x0, t, z1], [x0, y0, z1], 0, 0, 1, r, gg, bb);
          nt = topAt(ix, iz - 1, x0 + cs * 0.5, z0 - cs * 0.5); y0 = Math.max(nt, bot);
          if (y0 < t) quad([x0, y0, z0], [x0, t, z0], [x1, t, z0], [x1, y0, z0], 0, 0, -1, r, gg, bb);
        }
      }
      if (!pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, material);
      m.receiveShadow = true;
      meshes.push(m);
    }
  }
  return meshes;
}

/** Merge several [geometry, matrix] into one (for static props). */
export function mergeGeometries(list) {
  const pos = [], nor = [], col = [], idx = [];
  let off = 0;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const [geo, mat] of list) {
    nm.getNormalMatrix(mat);
    const p = geo.attributes.position, nn = geo.attributes.normal, c = geo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mat); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z);
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i)); else col.push(1, 1, 1);
    }
    const ix = geo.index;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
