import { getTrack } from '../js/tracks.js';
import { CAR_SPECS } from '../js/cars.js';
import { Vehicle } from '../js/physics.js';
const t = getTrack('monza');
const spec = CAR_SPECS.find((c) => c.id === (process.argv[2] || '911'));
const kmh = +(process.argv[3] || 120), steer = +(process.argv[4] || 1), assist = +(process.argv[5] ?? 0.55);
const v = new Vehicle(spec, t); v.assist = assist;
v.placeOnTrack(200, 0, kmh / 3.6);
for (let i = 0; i < 120 * 4; i++) {
  const tt = i / 120;
  v.step(1 / 120, { steer: tt > 0.5 ? steer : 0, throttle: v.speed < kmh / 3.6 ? 0.6 : 0.1, brake: 0, hb: false });
  if (i % 30 === 0) console.log(tt.toFixed(2), 'spd', (v.speed * 3.6).toFixed(0), 'delta', v.steer.toFixed(3), 'beta°', (Math.atan2(v.w, Math.max(Math.abs(v.u), 1)) * 57.3).toFixed(1), 'yaw', v.r.toFixed(2), 'latG', (v.latSm / 9.81).toFixed(2), 'axG', (v.axSm / 9.81).toFixed(2), 'off', v.q.off.toFixed(1));
}
