import * as THREE from '../vendor/three.module.js';
import { CAR_SPECS, createCarObject, carStats } from './cars.js';
import { TRACK_DEFS, getTrack } from './tracks.js';
import { buildWorld } from './world.js';
import { Race, fmtTime } from './game.js';
import { GameAudio } from './audio.js';
import { clamp } from './trackgen.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(60, 1, 0.2, 4200);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const audio = new GameAudio();

// ---------------------------------------------------------------- persistent state
const saved = (() => { try { return JSON.parse(localStorage.getItem('voxelgt.state') || '{}'); } catch { return {}; } })();
const S = Object.assign({ car: 0, colors: {}, stripe: {}, track: 0, laps: 3, diff: 'normal', line: true, assist: true, mode: 'race' }, saved);
const persist = () => { try { localStorage.setItem('voxelgt.state', JSON.stringify(S)); } catch { /* ignore */ } };
const bestKey = (t, c) => `voxelgt.best.${t}.${c}`;
const getBest = (t, c) => { try { const v = parseFloat(localStorage.getItem(bestKey(t, c))); return isFinite(v) ? v : null; } catch { return null; } };
const setBest = (t, c, v) => { try { localStorage.setItem(bestKey(t, c), String(v)); } catch { /* ignore */ } };
const colorIdx = (spec) => S.colors[spec.id] ?? 0;

// ---------------------------------------------------------------- garage / showroom scene
const gScene = new THREE.Scene();
gScene.background = new THREE.Color(0x090c18);
gScene.fog = new THREE.Fog(0x090c18, 18, 60);
gScene.add(new THREE.HemisphereLight(0x8fa4ff, 0x2a1840, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(5, 8, 6); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
gScene.add(key);
const rimA = new THREE.PointLight(0x35d8ff, 120, 30, 2); rimA.position.set(-6, 2.5, -4); gScene.add(rimA);
const rimB = new THREE.PointLight(0xff8a2a, 90, 30, 2); rimB.position.set(6, 2, -3); gScene.add(rimB);
{
  // voxel turntable platform
  const cnt = []; const R = 4.6, cs = 0.5;
  for (let x = -R; x <= R; x += cs) for (let z = -R; z <= R; z += cs) if (Math.hypot(x, z) < R) cnt.push([x, z]);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(cs * 0.98, 0.3, cs * 0.98), new THREE.MeshLambertMaterial({ color: 0xffffff }), cnt.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  cnt.forEach(([x, z], i) => {
    const edge = Hypot(x, z) > R - 0.6;
    m.makeTranslation(x, -0.15, z); inst.setMatrixAt(i, m);
    c.set(edge ? 0xffcb3d : (((Math.round(x / cs) + Math.round(z / cs)) & 1) ? 0x1b2340 : 0x2a345a));
    inst.setColorAt(i, c);
  });
  inst.receiveShadow = true; gScene.add(inst);
  // skyline columns
  const cols = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2, r = 26 + Math.random() * 16;
    cols.push([Math.cos(a) * r, Math.sin(a) * r, 1 + Math.random() * 9]);
  }
  const sk = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1, 1.8), new THREE.MeshLambertMaterial({ color: 0xffffff }), cols.length);
  cols.forEach(([x, z, h], i) => {
    const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2 - 0.3, z), new THREE.Quaternion(), new THREE.Vector3(1 + Math.random(), h, 1 + Math.random()));
    sk.setMatrixAt(i, mm);
    sk.setColorAt(i, new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.5, 0.12 + Math.random() * 0.12));
  });
  gScene.add(sk);
}
function Hypot(a, b) { return Math.sqrt(a * a + b * b); }
let garageCar = null;
const garageRoot = new THREE.Group(); gScene.add(garageRoot);
let garageSpin = 0, garageDrag = null, garageX = 0, garageTargetX = 0;
function setGarageCar() {
  if (garageCar) garageRoot.remove(garageCar);
  const spec = CAR_SPECS[S.car];
  garageCar = createCarObject(spec, spec.colors[colorIdx(spec)][1], !!S.stripe[spec.id]);
  garageCar.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  garageRoot.add(garageCar);
}

// ---------------------------------------------------------------- screens
let screen = 'title';
const screens = ['title', 'garage', 'tracks', 'controls', 'loading', 'pause', 'results'];
function show(name) {
  screen = name;
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  $('hud').classList.toggle('hidden', !(name === 'race' || name === 'pause'));
  if (name === 'title' || name === 'garage' || name === 'tracks' || name === 'controls') { garageTargetX = name === 'title' || name === 'controls' ? 2.4 : name === 'tracks' ? 0 : 0; }
}

// ---------------------------------------------------------------- garage UI
const stats = carStats();
function buildGarage() {
  const spec = CAR_SPECS[S.car], p = spec.perf, st = stats[S.car];
  $('g-brand').textContent = spec.brand.toUpperCase();
  $('g-model').textContent = spec.model;
  $('g-meta').textContent = `${spec.year} · ${spec.country.toUpperCase()} · ${spec.tagline.toUpperCase()}`;
  $('g-desc').textContent = spec.desc;
  const bar = (label, v, txt) => {
    const n = Math.round(clamp(v, 0.05, 1) * 12);
    let s = '<div class="bar"><span>' + label + '</span><div class="track">';
    for (let i = 0; i < 12; i++) s += `<i class="${i < n ? 'on' : ''}${i < n && i > 9 ? ' hot' : ''}"></i>`;
    return s + `</div><b>${txt}</b></div>`;
  };
  $('g-bars').innerHTML = bar('POWER', st.power, '') + bar('ACCEL', st.accel, '') + bar('TOP SPEED', st.speed, '') + bar('GRIP', st.grip, '');
  $('g-specs').innerHTML = [
    [Math.round(p.hp), 'HP'], [p.mass, 'KG'], [p.drive, 'DRIVE'],
    [Math.round(p.kmh / 5) * 5, 'KM/H MAX'], [Math.round(p.hp / p.mass * 1000), 'HP/TON'], [p.turbo ? 'TURBO' : 'NA', 'INDUCTION'],
  ].map(([v, l]) => `<div class="spec"><b>${v}</b><span>${l}</span></div>`).join('');
  $('g-swatches').innerHTML = '';
  spec.colors.forEach(([name, hex], i) => {
    const d = document.createElement('div');
    d.className = 'sw' + (i === colorIdx(spec) ? ' sel' : '');
    d.style.background = '#' + hex.toString(16).padStart(6, '0'); d.title = name;
    d.onclick = () => { S.colors[spec.id] = i; persist(); setGarageCar(); buildGarage(); };
    $('g-swatches').appendChild(d);
  });
  $('g-stripe').checked = !!S.stripe[spec.id];
  $('g-list').innerHTML = '';
  CAR_SPECS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = i === S.car ? 'sel' : '';
    b.innerHTML = `${c.brand.toUpperCase()} ${c.model}<small>${Math.round(c.perf.hp)} HP · ${c.perf.drive} · ${c.year}</small>`;
    b.onclick = () => { S.car = i; persist(); setGarageCar(); buildGarage(); };
    $('g-list').appendChild(b);
  });
}
$('g-stripe').onchange = (e) => { S.stripe[CAR_SPECS[S.car].id] = e.target.checked; persist(); setGarageCar(); };
const changeCar = (d) => { S.car = (S.car + d + CAR_SPECS.length) % CAR_SPECS.length; persist(); setGarageCar(); buildGarage(); };

// ---------------------------------------------------------------- track maps
function drawMap(cv, track, opts = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = opts.pad ?? 14;
  ctx.clearRect(0, 0, W, H);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.N; i += 4) { minX = Math.min(minX, track.X[i]); maxX = Math.max(maxX, track.X[i]); minZ = Math.min(minZ, track.Z[i]); maxZ = Math.max(maxZ, track.Z[i]); }
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc, oz = (H - (maxZ - minZ) * sc) / 2 - minZ * sc;
  const P = (i) => [track.X[i] * sc + ox, track.Z[i] * sc + oz];
  const path = (from, to) => { ctx.beginPath(); for (let i = from; i <= to; i += 3) { const [x, y] = P(i % track.N); i === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } };
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  const lw = opts.lw ?? 6;
  // draw non-bridge track in segments coloured by elevation, bridge last
  const drawSeg = (onlyBridge) => {
    for (let i = 0; i < track.N; i += 3) {
      const b = track.bridge[i];
      if (!!b !== onlyBridge) continue;
      const j = (i + 3) % track.N;
      const [x0, y0] = P(i), [x1, y1] = P(j);
      const e = clamp((track.Y[i] - track.minY) / Math.max(4, track.maxY - track.minY), 0, 1);
      ctx.strokeStyle = opts.mono ? '#fff' : `hsl(${200 - e * 160}, 90%, ${55 + e * 8}%)`;
      ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  };
  // dark outline
  ctx.strokeStyle = '#05070f'; ctx.lineWidth = lw + 5; path(0, track.N); ctx.closePath(); ctx.stroke();
  drawSeg(false);
  if (track.crossing) {
    ctx.strokeStyle = '#05070f'; ctx.lineWidth = lw + 5;
    ctx.beginPath(); let first = true; for (let i = 0; i < track.N; i += 3) if (track.bridge[i]) { const [x, y] = P(i); first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false; } ctx.stroke();
    drawSeg(true);
  }
  // start/finish
  const [sx, sy] = P(0);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(track.TZ[0], track.TX[0]) + Math.PI / 2);
  ctx.fillRect(-lw, -2, lw * 2, 4); ctx.strokeRect(-lw, -2, lw * 2, 4); ctx.restore();
  return { sc, ox, oz };
}

let mapTransform = null; const miniCanvas = document.createElement('canvas'); miniCanvas.width = 170; miniCanvas.height = 170;

// ---------------------------------------------------------------- track select UI
function seg(el, options, current, onPick) {
  el.innerHTML = '';
  options.forEach(([val, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = val === current ? 'sel' : '';
    b.onclick = () => { onPick(val); };
    el.appendChild(b);
  });
}
function buildTracks() {
  const cards = $('t-cards'); cards.innerHTML = '';
  TRACK_DEFS.forEach((m, i) => {
    const t = getTrack(m.id);
    const d = document.createElement('div'); d.className = 'tcard' + (i === S.track ? ' sel' : '');
    d.innerHTML = `<div class="tn">${m.short}</div><div class="tc">${m.country.toUpperCase()}</div><canvas width="300" height="120"></canvas><div class="tl">${(t.L / 1000).toFixed(2)} KM · ${m.nickname}</div>`;
    d.onclick = () => { S.track = i; persist(); buildTracks(); };
    cards.appendChild(d);
    drawMap(d.querySelector('canvas'), t, { lw: 4, pad: 8 });
  });
  const m = TRACK_DEFS[S.track], t = getTrack(m.id);
  $('t-name').textContent = m.name; $('t-nick').textContent = m.nickname.toUpperCase(); $('t-blurb').textContent = m.blurb;
  let corners = 0, prev = 0; for (let i = 0; i < t.N; i += 6) { const k = Math.abs(t.K[i]) > 1 / 120; if (k && !prev) corners++; prev = k; }
  const spec = CAR_SPECS[S.car], best = getBest(m.id, spec.id);
  $('t-stats').innerHTML = [[(t.L / 1000).toFixed(2) + ' km', 'LENGTH'], [corners, 'CORNERS'], [(t.maxY - t.minY - (t.crossing ? 10 : 0)).toFixed(0) + ' m', 'ELEVATION'], [m.country, 'COUNTRY']]
    .map(([v, l]) => `<div class="spec"><b>${v}</b><span>${l}</span></div>`).join('');
  $('t-best').textContent = best ? `YOUR BEST (${spec.brand} ${spec.model}): ${fmtTime(best)}` : `NO LAP TIME YET WITH THE ${spec.brand.toUpperCase()} ${spec.model.toUpperCase()}`;
  drawMap($('t-map'), t, { lw: 7, pad: 20 });
  const isRace = S.mode === 'race';
  $('o-laps-wrap').style.display = isRace ? '' : 'none'; $('o-diff-wrap').style.display = isRace ? '' : 'none';
  seg($('o-laps'), [[2, '2'], [3, '3'], [5, '5'], [8, '8']], S.laps, (v) => { S.laps = v; persist(); buildTracks(); });
  seg($('o-diff'), [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], S.diff, (v) => { S.diff = v; persist(); buildTracks(); });
  seg($('o-line'), [[true, 'ON'], [false, 'OFF']], S.line, (v) => { S.line = v; persist(); buildTracks(); });
  seg($('o-assist'), [[true, 'ON'], [false, 'OFF']], S.assist, (v) => { S.assist = v; persist(); buildTracks(); });
}

// ---------------------------------------------------------------- input
const keys = new Set();
const input = { steer: 0, throttle: 0, brake: 0, hb: false };
let padPrev = {};
window.addEventListener('keydown', (e) => {
  audio.init();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (screen === 'race') {
    if (e.code === 'KeyC') race.cycleCamera();
    else if (e.code === 'KeyL') { race.showLine = !race.showLine; S.line = race.showLine; persist(); }
    else if (e.code === 'KeyR') race.player.veh.relocateToTrack();
    else if (e.code === 'Escape' || e.code === 'KeyP') pauseGame(true);
  } else if (screen === 'pause') {
    if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter') pauseGame(false);
  } else if (screen === 'garage') {
    if (e.code === 'ArrowLeft') changeCar(-1); else if (e.code === 'ArrowRight') changeCar(1); else if (e.code === 'Enter') goTracks();
    else if (e.code === 'Escape') show('title');
  } else if (screen === 'tracks') {
    if (e.code === 'ArrowLeft') { S.track = (S.track + TRACK_DEFS.length - 1) % TRACK_DEFS.length; persist(); buildTracks(); }
    else if (e.code === 'ArrowRight') { S.track = (S.track + 1) % TRACK_DEFS.length; persist(); buildTracks(); }
    else if (e.code === 'Enter') launch(); else if (e.code === 'Escape') goGarage();
  } else if (screen === 'title') {
    if (e.code === 'Enter') { S.mode = 'race'; goGarage(); }
  }
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (screen === 'race') pauseGame(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'race') pauseGame(true); });

let thrS = 0, brkS = 0;
function pollInput(dt) {
  const k = (c) => keys.has(c);
  let steer = (k('ArrowLeft') || k('KeyA') ? 1 : 0) - (k('ArrowRight') || k('KeyD') ? 1 : 0);
  let thr = k('ArrowUp') || k('KeyW') ? 1 : 0, brk = k('ArrowDown') || k('KeyS') ? 1 : 0, hb = k('Space');
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer = -ax * (Math.abs(ax) > 0.9 ? 1 : 1);
    const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
    if (rt > 0.05) thr = Math.max(thr, rt); if (lt > 0.05) brk = Math.max(brk, lt);
    if (gp.buttons[2]?.pressed) hb = true;
    const edge = (i, fn) => { const p = !!gp.buttons[i]?.pressed; if (p && !padPrev[i]) fn(); padPrev[i] = p; };
    edge(3, () => screen === 'race' && race.cycleCamera());
    edge(9, () => { if (screen === 'race') pauseGame(true); else if (screen === 'pause') pauseGame(false); });
    break;
  }
  thrS += clamp(thr - thrS, -dt * 9, dt * 6);
  brkS += clamp(brk - brkS, -dt * 9, dt * 7);
  input.steer = steer; input.throttle = thrS; input.brake = brkS; input.hb = hb;
}

// ---------------------------------------------------------------- race lifecycle
let race = null, world = null, raceScene = null, raceTrackId = null, sunLight = null;
let paused = false, lastBoard = 0, boardKey = '';

function makeRaceScene(track) {
  const th = track.meta.theme;
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(th.fog);
  sc.fog = new THREE.Fog(th.fog, 160, th.fogFar * 0.95);
  sc.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiI * 2.3));
  const sun = new THREE.DirectionalLight(th.sun, th.sunI * 1.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 260 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  sc.add(sun); sc.add(sun.target);
  sunLight = sun;
  return sc;
}

async function launch(opts = {}) {
  audio.init();
  show('loading');
  $('load-text').textContent = 'BUILDING ' + TRACK_DEFS[S.track].short.toUpperCase() + '…';
  await new Promise((r) => setTimeout(r, 60));
  const meta = TRACK_DEFS[S.track];
  const track = getTrack(meta.id);
  if (race) { race.dispose(); race = null; }
  if (world && raceTrackId !== meta.id) { raceScene.remove(world.group); world.dispose(); world = null; raceScene = null; }
  if (!world) {
    world = buildWorld(track);
    raceScene = makeRaceScene(track);
    raceScene.add(world.group);
    raceTrackId = meta.id;
    renderer.compile(raceScene, camera);
  }
  startRaceSession(track);
}

function startRaceSession(track) {
  if (race) race.dispose();
  const spec = CAR_SPECS[S.car];
  race = new Race({
    scene: raceScene, camera, sun: sunLight, track, audio, spec, color: spec.colors[colorIdx(spec)][1], stripe: !!S.stripe[spec.id],
    mode: S.mode, laps: S.laps, difficulty: S.diff, assist: S.assist ? 0.85 : 0,
    onLap: (c, lt) => {
      const prev = getBest(track.id, spec.id);
      if (prev === null || lt < prev) setBest(track.id, spec.id, lt);
    },
  });
  race.showLine = S.line;
  audio.setCar(spec.perf);
  buildMiniMap(track);
  paused = false; boardKey = '';
  $('h-keys').style.opacity = 1; setTimeout(() => { $('h-keys').style.opacity = 0; }, 9000);
  $('h-laps').textContent = S.mode === 'tt' ? '∞' : S.laps;
  show('race');
  lastT = performance.now();
}

function buildMiniMap(track) {
  const r = drawMap(miniCanvas, track, { lw: 5, pad: 10, mono: true });
  mapTransform = r;
}

function pauseGame(p) {
  if (!race) return;
  paused = p;
  if (p) { show('pause'); audio.silence(); } else { show('race'); lastT = performance.now(); }
}

function endRace() {
  const st = race.standings();
  const me = race.player;
  const ord = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];
  $('r-title').textContent = (ord[me.pos - 1] || me.pos + 'TH') + ' PLACE';
  $('r-sub').textContent = `${TRACK_DEFS[S.track].name.toUpperCase()} · ${race.laps} LAPS · ${S.diff.toUpperCase()}`;
  const winT = st[0].finishTime ?? race.t;
  const estimate = (c) => {
    if (c.finished) return c.finishTime;
    const rem = (race.laps * race.track.L) - c.total;
    return race.t + Math.max(0, rem) / Math.max(c.veh.speed, 25);
  };
  let rows = '<tr><th>POS</th><th>DRIVER</th><th>CAR</th><th>BEST LAP</th><th>TIME</th></tr>';
  st.forEach((c, i) => {
    const tt = estimate(c);
    const hex = '#' + c.color.toString(16).padStart(6, '0');
    rows += `<tr class="${c.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td class="nm">${c.isPlayer ? 'YOU' : c.name}</td><td class="nm"><span class="swatch" style="background:${hex}"></span>${c.spec.brand} ${c.spec.model}</td><td>${fmtTime(c.bestLap)}</td><td>${i === 0 ? fmtTime(tt) : '+' + (tt - estimate(st[0])).toFixed(3)}${c.finished ? '' : '*'}</td></tr>`;
  });
  $('r-table').innerHTML = rows;
  show('results');
  audio.silence();
}

function leaveRace(to) {
  if (race) { race.dispose(); race = null; }
  audio.silence();
  if (to === 'title') { show('title'); } else if (to === 'garage') goGarage(); else goTracks();
}

// ---------------------------------------------------------------- navigation
function goGarage() { setGarageCar(); buildGarage(); show('garage'); }
function goTracks() { buildTracks(); show('tracks'); }

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  audio.init();
  switch (a.dataset.act) {
    case 'start-race': S.mode = 'race'; goGarage(); break;
    case 'start-tt': S.mode = 'tt'; goGarage(); break;
    case 'show-controls': show('controls'); break;
    case 'back-title': show('title'); break;
    case 'to-tracks': goTracks(); break;
    case 'to-garage': goGarage(); break;
    case 'car-prev': changeCar(-1); break;
    case 'car-next': changeCar(1); break;
    case 'launch': launch(); break;
    case 'resume': pauseGame(false); break;
    case 'restart': startRaceSession(getTrack(TRACK_DEFS[S.track].id)); break;
    case 'quit-tracks': leaveRace('tracks'); break;
    case 'quit-garage': leaveRace('garage'); break;
    case 'quit-title': leaveRace('title'); break;
  }
});

// garage drag-to-rotate
canvas.addEventListener('pointerdown', (e) => { if (screen === 'garage' || screen === 'title') garageDrag = { x: e.clientX, spin: garageSpin }; });
window.addEventListener('pointerup', () => { garageDrag = null; });
window.addEventListener('pointermove', (e) => { if (garageDrag) garageSpin = garageDrag.spin + (e.clientX - garageDrag.x) * 0.01; });

// ---------------------------------------------------------------- HUD
const rpmEl = $('h-rpm');
for (let i = 0; i < 24; i++) rpmEl.appendChild(document.createElement('i'));
const rpmBlocks = [...rpmEl.children];
const hudEls = { pos: $('h-pos'), count: $('h-count'), lap: $('h-lap'), cur: $('h-cur'), last: $('h-last'), best: $('h-best'), kmh: $('h-kmh'), gear: $('h-gear'), cd: $('h-cd'), msg: $('h-msg'), sub: $('h-sub'), wrong: $('h-wrong') };
const mapCtx = $('h-map').getContext('2d');
let hudPrev = {};
function setText(el, v) { if (hudPrev[el.id] !== v) { hudPrev[el.id] = v; el.textContent = v; } }

function updateHudDom(now) {
  const h = race.hud;
  setText(hudEls.pos, h.pos); setText(hudEls.count, h.count); setText(hudEls.lap, h.lap);
  setText(hudEls.cur, fmtTime(h.lapNow)); setText(hudEls.last, fmtTime(h.last)); setText(hudEls.best, fmtTime(h.best));
  setText(hudEls.kmh, h.kmh); setText(hudEls.gear, h.gear);
  setText(hudEls.cd, h.cd);
  setText(hudEls.msg, h.msg ? h.msg.text : ''); setText(hudEls.sub, h.msg ? h.msg.sub : '');
  hudEls.wrong.classList.toggle('hidden', !h.wrongWay);
  const lit = Math.round(h.rpm * 24);
  const cls = rpmBlocks.length;
  for (let i = 0; i < cls; i++) {
    const on = i < lit;
    const c = 'on' + (i > 18 ? ' r' : i > 14 ? ' y' : '');
    const want = on ? c : '';
    if (rpmBlocks[i].dataset.c !== want) { rpmBlocks[i].dataset.c = want; rpmBlocks[i].className = want; }
  }
  // minimap
  mapCtx.clearRect(0, 0, 200, 200);
  mapCtx.drawImage(miniCanvas, 0, 0, 170, 170, 0, 0, 170, 170);
  const { sc, ox, oz } = mapTransform;
  for (const c of race.cars) {
    const x = c.veh.x * sc + ox, y = c.veh.z * sc + oz;
    mapCtx.fillStyle = c.isPlayer ? '#ffcb3d' : '#' + c.color.toString(16).padStart(6, '0');
    mapCtx.strokeStyle = '#000'; mapCtx.lineWidth = 2;
    mapCtx.beginPath(); mapCtx.arc(x, y, c.isPlayer ? 5.5 : 4, 0, 7); mapCtx.fill(); mapCtx.stroke();
  }
  // leaderboard (4 Hz)
  if (now - lastBoard > 250 && S.mode === 'race') {
    lastBoard = now;
    const st = race.standings();
    const k = st.map((c) => c.id).join(',');
    if (k !== boardKey || true) {
      boardKey = k;
      $('h-board').innerHTML = st.map((c, i) => `<div class="${c.isPlayer ? 'me' : ''}" style="border-left-color:#${c.color.toString(16).padStart(6, '0')}"><b>${i + 1}</b>${c.isPlayer ? 'YOU' : c.name}</div>`).join('');
    }
  }
}

// ---------------------------------------------------------------- main loop
let lastT = performance.now(), t0 = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  pollInput(dt);
  if (race && (screen === 'race' || screen === 'results')) {
    if (screen === 'race' && !paused) {
      race.update(dt, input);
      if (window.__vgt.cam) { const c = window.__vgt.cam; camera.position.set(...c.pos); camera.lookAt(...c.look); if (c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); } }
      world.update(camera.position, now / 1000);
      audio.update(race.player.veh.rpm, race.player.veh.throttle, race.player.veh.speed, race.player.veh.skid);
      updateHudDom(now);
      if (race.done && S.mode === 'race') endRace();
    } else if (screen === 'results') {
      race.update(dt, input);
    }
    renderer.render(raceScene, camera);
  } else if (race && screen === 'pause') {
    renderer.render(raceScene, camera);
  } else {
    // showroom
    const t = (now - t0) / 1000;
    garageX += (garageTargetX - garageX) * Math.min(1, dt * 4);
    if (!garageDrag) garageSpin += dt * 0.35;
    garageRoot.position.x = garageX; garageRoot.rotation.y = garageSpin;
    if (garageCar) garageCar.userData.wheels.forEach((w) => { w.spin.rotation.x = t * 3; });
    camera.fov = 38; camera.updateProjectionMatrix();
    const camX = screen === 'title' ? 0.5 : 0;
    camera.position.set(camX + Math.sin(t * 0.12) * 0.6, 2.6, 11.2); camera.lookAt(camX * 0.4, 0.7, 0);
    renderer.render(gScene, camera);
  }
}

// ---------------------------------------------------------------- boot
S.car = clamp(S.car, 0, CAR_SPECS.length - 1); S.track = clamp(S.track, 0, TRACK_DEFS.length - 1);
setGarageCar(); buildGarage();
show('title');
requestAnimationFrame(frame);

// test hooks / quick start: ?auto=1&track=monza&car=911&mode=race
if (params.get('auto')) {
  const ti = TRACK_DEFS.findIndex((t) => t.id === params.get('track'));
  if (ti >= 0) S.track = ti;
  const ci = CAR_SPECS.findIndex((c) => c.id === params.get('car'));
  if (ci >= 0) S.car = ci;
  S.mode = params.get('mode') || 'race';
  S.laps = +(params.get('laps') || 3);
  launch();
}
window.__vgt = { get race() { return race; }, S, input, launch, keys, cam: null, getTrack };
