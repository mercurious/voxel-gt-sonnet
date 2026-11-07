import { getTrack } from '../js/tracks.js';
import { CAR_SPECS } from '../js/cars.js';
import { Vehicle } from '../js/physics.js';
const t = getTrack('monza');
for (const spec of CAR_SPECS) {
  for (const [kmh, steer] of [[60, 1], [120, 1], [120, 0.5], [200, 0.5]]) {
    const v = new Vehicle(spec, t); v.assist = 0.55;
    v.placeOnTrack(200, 0, kmh / 3.6);
    // hold speed with light throttle, then steer
    let maxLat = 0, maxBeta = 0, yaw = 0;
    for (let i = 0; i < 120 * 3; i++) {
      const tt = i / 120;
      const ctl = { steer: tt > 0.5 ? steer : 0, throttle: v.speed < kmh / 3.6 ? 0.6 : 0.15, brake: 0, hb: false };
      v.step(1 / 120, ctl);
      // keep it on the road for the test
      if (Math.abs(v.q.off) > 40) break;
      maxLat = Math.max(maxLat, Math.abs(v.latSm) / 9.81);
      maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.w, Math.max(Math.abs(v.u), 1))));
    }
    console.log(spec.id.padEnd(6), kmh, 'steer', steer, 'latG', maxLat.toFixed(2), 'beta deg', (maxBeta * 57.3).toFixed(0), 'speed end', (v.speed * 3.6).toFixed(0), 'yawrate', v.r.toFixed(2));
  }
}
