import { getTrack, TRACK_DEFS } from '../js/tracks.js';
for (const m of TRACK_DEFS) {
  const t0 = performance.now();
  const t = getTrack(m.id);
  let bridge = 0; for (const b of t.bridge) bridge += b;
  let kmax = 0; for (const k of t.K) kmax = Math.max(kmax, Math.abs(k));
  let smax = 0; for (const k of t.slope) smax = Math.max(smax, Math.abs(k));
  let ro = 0; for (const o of t.ROFF) ro = Math.max(ro, Math.abs(o));
  console.log(m.id, 'L', t.L.toFixed(0), 'N', t.N, 'Y', t.minY.toFixed(1), t.maxY.toFixed(1), 'bridge samples', bridge, 'crossing', JSON.stringify(t.crossing), 'minR', (1 / kmax).toFixed(0), 'maxslope', (smax * 100).toFixed(1) + '%', 'maxRLoff', ro.toFixed(1), 'ms', (performance.now() - t0).toFixed(0));
}
