import programs from './programs.mjs';
import { turtle } from '../js/trackgen.js';
const name = process.argv[2];
const cfg = programs[name];
let prog = cfg.prog;
if (process.argv[3]) { const o = JSON.parse(process.argv[3]); prog = prog.map((c, i) => (o[i] !== undefined ? { ...c, s: o[i] } : c)); }
let acc = [];
let tot = 0;
prog.forEach((c, i) => {
  const { end } = turtle(prog.slice(0, i + 1), 2, cfg.startBearing);
  const len = c.s !== undefined ? c.s : Math.abs(c.a) * Math.PI / 180 * c.r; tot += len;
  console.log(String(i).padStart(2), (c.s !== undefined ? 'S ' + c.s : 'R ' + c.r + ' a' + c.a).padEnd(14), 'E', end.e.toFixed(0).padStart(6), 'N', end.n.toFixed(0).padStart(6), 'b', end.b.toFixed(0).padStart(5), 'len', tot.toFixed(0));
});
