// Dump an SVG overview of each raw turtle program (debug aid)
import fs from 'node:fs';
import programs from './programs.mjs';
import { turtle, normalizeArcs } from '../js/trackgen.js';
const which = process.argv[2];
let src = programs;
let tuned = process.env.RAW ? null : undefined; if (tuned === undefined) tuned = null;
try { tuned = (await import('../js/trackdata.js')).default; } catch {}
let svgs = '';
for (const name of Object.keys(programs).filter((n) => !which || which === 'x' || n === which)) {
  const prog = tuned ? tuned[name].prog : normalizeArcs(programs[name].prog, programs[name].net);
  const { pts } = turtle(prog, 4, programs[name].startBearing);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  pts.forEach((p) => { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
  const w = maxx - minx + 100, h = maxy - miny + 100;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - minx + 50).toFixed(1)},${(maxy - p[1] + 50).toFixed(1)}`).join('');
  svgs += `<div style="display:inline-block;margin:6px"><div>${name} ${w.toFixed(0)}x${h.toFixed(0)}</div><svg width="${w * 0.45}" height="${h * 0.45}" viewBox="0 0 ${w} ${h}" style="background:#223"><path d="${d}" stroke="#fd3" stroke-width="14" fill="none"/><circle cx="${50 - minx}" cy="${maxy + 50}" r="22" fill="#f33"/></svg></div>`;
}
fs.writeFileSync(process.argv[3] || 'preview.html', `<body style="background:#111;color:#fff;font:14px sans-serif">${svgs}</body>`);
