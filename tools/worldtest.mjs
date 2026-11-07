import { getTrack, TRACK_DEFS } from '../js/tracks.js';
import { buildWorld } from '../js/world.js';
for (const m of TRACK_DEFS) {
  const t = getTrack(m.id);
  const t0 = performance.now();
  const w = buildWorld(t);
  let tris = 0, meshes = 0;
  w.group.traverse((o) => { if (o.isMesh && o.geometry.index) { tris += o.geometry.index.count / 3; meshes++; } });
  console.log(m.id, 'build ms', (performance.now() - t0).toFixed(0), 'meshes', meshes, 'tris', tris, 'trees', w.group.userData.trees);
}
