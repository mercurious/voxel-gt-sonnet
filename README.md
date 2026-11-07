# VOXEL GT

A Gran Turismo-style driving game made entirely of voxels. Runs in the browser (Three.js, no build step).

**Play:** `./play.sh` (or `python3 -m http.server 8080` and open <http://localhost:8080/>).
Three.js r160 is vendored in `vendor/`, so it works offline.

## Cars (5, real brands)
| Car | Drive | Power | Character |
|---|---|---|---|
| Mazda RX-7 Spirit R | RWD | 280 hp / 1280 kg | light, nimble rotary turbo |
| Toyota Supra RZ (A80) | RWD | 325 hp / 1510 kg | 2JZ torque, stable, long legs |
| Nissan Skyline GT-R V-Spec (R34) | AWD | 340 hp / 1560 kg | traction monster, easiest to drive fast |
| Porsche 911 GT3 | RWD | 500 hp / 1435 kg | huge grip + aero, rear-engine twitch |
| Ferrari F40 | RWD | 471 hp / 1254 kg | big turbo lag, then a fierce tail |

Each has 6 paint colours + optional racing stripes, its own engine note, brake lights, spinning wheels and live body roll/pitch.

## Circuits (3, real layouts, simplified and scaled)
* **Monza** (Italy) - Rettifilo chicane, Curva Grande, Roggia, Lesmos, Ascari, Parabolica. Flat and fast.
* **Suzuka** (Japan) - the figure-eight: the back straight really does cross *over* the Degner run-in on a voxel bridge. S-curves, hairpin, Spoon, 130R, Casio chicane, plus the Ferris wheel.
* **Laguna Seca** (USA) - Andretti hairpin, blind crests, and the Corkscrew (~12% downhill left-right).

Tracks are generated from "turtle" programs (straights + arcs, see `js/trackdata.js`, closed by `tools/tune.mjs`/`tune2.mjs`), then turned into a smooth spline, an elevation profile, a racing line, and a voxel terrain (1 m columns near the road, 8 m hills further out).

## Modes
* **Arcade Race** - 6-car grid, standing start with countdown, 2-8 laps, 3 AI difficulties.
* **Time Trial** - solo, with a ghost of your best lap.

## Controls
`W/S` or `Up/Down` throttle/brake (hold brake when stopped to reverse) · `A/D` or `Left/Right` steer · `Space` handbrake ·
`C` camera (chase / far / cockpit / bumper) · `L` driving line (green = go, yellow = lift, red = brake) · `R` reset onto track ·
`M` mute · `Esc`/`P` pause. Gamepad: left stick, RT/LT, X handbrake, Y camera, Start pause.

## How it works
* `js/physics.js` - 2D bicycle model with Pacejka-style slip-angle tyres, friction circle (power oversteer, trail-braking), load transfer, aero drag + downforce, turbo lag, 6-speed auto box, grade, kerbs/grass/walls. Optional steering assist caps front slip angle and counter-steers slides.
* `js/ai.js` - racing-line follower with a braking-aware speed profile computed per car (so a Porsche brakes later than a Supra), pure-pursuit steering, side-by-side avoidance.
* `js/cars.js` - voxel car models are generated from side-profile tables (hood line, roof line, width, arches, lights, wings) and meshed with face culling + ambient-occlusion shading.
* `js/world.js`, `js/voxel.js` - column-meshed terrain, kerbs, barriers, grandstands with crowds, bridge deck + piers, instanced trees, voxel sky/clouds/mountains.
* `js/audio.js` - synthesized engine, tyre squeal, wind and impacts (WebAudio, no samples).

`tools/` has the track tuning/preview/simulation scripts used during development (`node tools/simtest.mjs` runs headless AI laps of every car on every track).
