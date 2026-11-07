import { getTrack, TRACK_DEFS } from '../js/tracks.js';
import { CAR_SPECS } from '../js/cars.js';
import { Vehicle } from '../js/physics.js';
import { AIDriver } from '../js/ai.js';
const only = process.argv[2];
for (const m of TRACK_DEFS) {
  if (only && m.id !== only) continue;
  const t = getTrack(m.id);
  for (const spec of CAR_SPECS) {
    const v = new Vehicle(spec, t); v.assist = +(process.env.ASSIST ?? 0.9);
    v.placeOnTrack(t.N - 10, 0, 0);
    const ai = new AIDriver(v, t, { pace: 0.95 });
    let time = 0, lap = 0, prevS = t.N - 10, lapStart = 0, laps = [], grass = 0, wall = 0, maxOff = 0, vmax = 0, nan = false;
    const dt = 1 / 120;
    for (let step = 0; step < 120 * 400 && laps.length < 3; step++) {
      const ctl = ai.control(dt);
      v.step(dt, ctl);
      time += dt;
      if (v.hit > 0.5) { wall++; v.hit = 0; }
      if (v.onGrass) grass += dt;
      maxOff = Math.max(maxOff, Math.abs(v.q.off));
      vmax = Math.max(vmax, v.speed);
      const s = ((v.q.u % t.N) + t.N) % t.N;
      if (prevS > t.N * 0.75 && s < t.N * 0.25) { lap++; if (lap >= 2) { laps.push(time - lapStart); } lapStart = time; }
      prevS = s;
      if (!isFinite(v.x)) { nan = true; break; }
      if (ai.stuck > 3) { v.relocateToTrack(); ai.stuck = 0; wall += 100; }
    }
    console.log(m.id.padEnd(7), spec.id.padEnd(6), 'laps', laps.map((l) => l.toFixed(1)).join(' '), 'vmax', (vmax * 3.6).toFixed(0), 'grass s', grass.toFixed(1), 'walls', wall, 'maxOff', maxOff.toFixed(1), nan ? 'NaN!' : '');
  }
}
