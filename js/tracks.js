// Track catalogue: three real circuits, rendered in a simplified, game-scale voxel form.
import data from './trackdata.js';
import { Track } from './trackgen.js';

function cumFractions(prog) {
  const cum = [0]; let t = 0;
  for (const c of prog) { t += c.s !== undefined ? c.s : Math.abs(c.a) * Math.PI / 180 * c.r; cum.push(t); }
  return { cum, total: t };
}
function elevByIndex(prog, pts) {
  const { cum, total } = cumFractions(prog);
  return pts.map(([i, y]) => [cum[i] / total, y]).sort((a, b) => a[0] - b[0]);
}

export const TRACK_DEFS = [
  {
    id: 'monza',
    name: 'Autodromo Nazionale Monza',
    short: 'Monza',
    country: 'Italy',
    nickname: 'The Temple of Speed',
    blurb: 'Long flat-out straights, tight chicanes and the sweeping Parabolica. Slipstream and big brakes.',
    elevIdx: [[0, 0], [10, 0], [12, 1.5], [14, 1.0], [16, 0]],
    hw: 7.5,
    seed: 11,
    theme: {
      skyTop: 0x3f86e0, skyHorizon: 0xd7ebf8, fog: 0xcfe3f1, fogFar: 1900,
      sun: 0xfff3dc, sunDir: [0.45, 0.8, 0.35], sunI: 2.3, hemiSky: 0xbcd8ff, hemiGround: 0x6a8a4a, hemiI: 1.05,
      grass: 0x5da242, grassAlt: 0x52933a, road: 0x3d3e45, hill: 0x6aa84f, hillAmp: 16,
      trees: { kind: 'broad', density: 0.075, leaf: [0x3f8f3a, 0x4ea14a, 0x2f7a38], trunk: 0x6b4a2b },
      sponsors: ['PIRELLI', 'AGIP', 'MARTINI', 'ROLEX'],
      landmarks: [{ type: 'stand', frac: 0.995, len: 200, side: 1 }, { type: 'pit', frac: 0.995, len: 200, side: -1 }],
      mountains: 0xb6c7d8,
    },
  },
  {
    id: 'suzuka',
    name: 'Suzuka International Racing Course',
    short: 'Suzuka',
    country: 'Japan',
    nickname: 'The Figure-Eight Circuit',
    blurb: 'The only figure-eight on the calendar: the back straight crosses over the Degner run-in. S-curves, a tight hairpin, and the double-apex Spoon.',
    elevIdx: [[0, 0], [3, 1], [9, 4], [13, 3], [15, 0], [18, -0.5], [19, 0], [22, 2], [25, 1], [30, 0]],
    hw: 7.5,
    seed: 23,
    scale: 1.35,
    bridge: { h: 10, ramp: 130, plateau: 34 },
    theme: {
      skyTop: 0x4b92e6, skyHorizon: 0xe3eef3, fog: 0xd6e5ec, fogFar: 1700,
      sun: 0xfff0d4, sunDir: [-0.5, 0.65, 0.5], sunI: 2.2, hemiSky: 0xc4dcff, hemiGround: 0x4f7a3b, hemiI: 1.0,
      grass: 0x4f9440, grassAlt: 0x438436, road: 0x3b3c43, hill: 0x3d7a3a, hillAmp: 46,
      trees: { kind: 'conifer', density: 0.16, leaf: [0x2c6a3c, 0x255c34, 0x347a42], trunk: 0x5a3d25 },
      sponsors: ['HONDA', 'ENEOS', 'BRIDGESTONE', 'DENSO'],
      landmarks: [{ type: 'ferris', frac: 0.93, lat: 85 }, { type: 'stand', frac: 0.995, len: 170, side: 1 }, { type: 'pit', frac: 0.995, len: 170, side: -1 }],
      mountains: 0x9fb8b0,
    },
  },
  {
    id: 'laguna',
    name: 'WeatherTech Raceway Laguna Seca',
    short: 'Laguna Seca',
    country: 'USA',
    nickname: 'Home of the Corkscrew',
    blurb: 'Blind crests, the Andretti hairpin, and the legendary Corkscrew: a left-right plunge down 18 metres.',
    elevIdx: [[0, 0], [2, 3], [3, 14], [5, 12], [9, 9], [11, 17], [13, 15], [14, 13], [15, 12], [19, -5], [22, -3], [24, -1]],
    hw: 7.0,
    seed: 37,
    scale: 1.3,
    theme: {
      skyTop: 0x3a74c4, skyHorizon: 0xf6dcae, fog: 0xecd6ae, fogFar: 1800,
      sun: 0xffd9a0, sunDir: [0.7, 0.42, -0.45], sunI: 2.5, hemiSky: 0xa9c4f0, hemiGround: 0x8a7440, hemiI: 0.95,
      grass: 0xb9a355, grassAlt: 0xa8924a, road: 0x403f44, hill: 0xc9ab62, hillAmp: 60,
      trees: { kind: 'oak', density: 0.02, leaf: [0x4a6b2a, 0x3f5e2c, 0x56762f], trunk: 0x5a4028 },
      sponsors: ['MAZDA', 'MOBIL 1', 'PENNZOIL', 'WEATHERTECH'],
      landmarks: [{ type: 'stand', frac: 0.995, len: 150, side: 1 }, { type: 'pit', frac: 0.995, len: 150, side: -1 }],
      mountains: 0xc8a978,
    },
  },
];

const cache = new Map();
export function getTrack(id) {
  if (cache.has(id)) return cache.get(id);
  const meta = TRACK_DEFS.find((t) => t.id === id);
  const d = data[id];
  const k = meta.scale || 1;
  const prog = d.prog.map((c) => (c.s !== undefined ? { ...c, s: c.s * k } : { ...c, r: c.r * k }));
  const def = { ...meta, prog, startBearing: d.startBearing, elev: elevByIndex(prog, meta.elevIdx) };
  const t = new Track(def);
  t.meta = meta;
  cache.set(id, t);
  return t;
}
