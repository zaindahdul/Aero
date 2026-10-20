// Extracts gas-phase C/H/O/N/Ar/He species from the NASA Glenn thermodynamic
// database (thermo.inp, McBride, Zehe & Gordon, NASA TP-2002-211556) and
// writes them as NASA-9 polynomial records for the equilibrium solver.
//
//   node scripts/build-thermo.mjs path/to/thermo.inp
//
// thermo.inp ships with NASA CEA (and with RocketCEA). The format is fixed
// column Fortran; see Appendix A of NASA TP-2002-211556.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ALLOWED = new Set(['C', 'H', 'O', 'N', 'AR', 'HE']);
const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-thermo.mjs path/to/thermo.inp');
  process.exit(1);
}

const lines = readFileSync(src, 'utf8').split(/\r?\n/);
const num = (s) => Number(s.trim().replace(/D/gi, 'E'));
const species = [];

let i = lines.findIndex((l) => l.startsWith('thermo')) + 2;
while (i < lines.length && !lines[i].startsWith('END PRODUCTS')) {
  const header = lines[i];
  const rec = lines[i + 1];
  const nIntervals = parseInt(rec.slice(0, 2), 10);
  const name = header.slice(0, 18).trim();
  const elements = {};
  for (let k = 0; k < 5; k++) {
    const sym = rec.slice(10 + 8 * k, 12 + 8 * k).trim();
    const count = num(rec.slice(12 + 8 * k, 18 + 8 * k));
    if (sym && count !== 0) elements[sym.toUpperCase()] = count;
  }
  const phase = parseInt(rec.slice(50, 52), 10);
  const mw = num(rec.slice(52, 65));
  const hf = num(rec.slice(65, 80));

  const ranges = [];
  for (let k = 0; k < nIntervals; k++) {
    const t = lines[i + 2 + 3 * k];
    const c1 = lines[i + 3 + 3 * k];
    const c2 = lines[i + 4 + 3 * k];
    const field = (line, n) => num(line.slice(16 * n, 16 * n + 16));
    ranges.push({
      tmin: num(t.slice(0, 11)),
      tmax: num(t.slice(11, 22)),
      a: [field(c1, 0), field(c1, 1), field(c1, 2), field(c1, 3), field(c1, 4), field(c2, 0), field(c2, 1)],
      b: [num(c2.slice(48, 64)), num(c2.slice(64, 80))],
    });
  }
  // Zero-interval records (fixed-temperature reactants) carry one temperature line.
  i += nIntervals === 0 ? 3 : 2 + 3 * nIntervals;

  const symbols = Object.keys(elements);
  const ok =
    phase === 0 &&
    nIntervals >= 2 &&
    symbols.length > 0 &&
    symbols.every((s) => ALLOWED.has(s)) &&
    !name.endsWith('+') &&
    !name.endsWith('-');
  if (ok) species.push({ name, elements, mw, hf, ranges: ranges.filter((r) => r.tmin < 6000.5) });
}

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src', 'core', 'thermo', 'data', 'nasa9-gas.json');
writeFileSync(
  dest,
  JSON.stringify({
    source: 'NASA Glenn thermodynamic database (thermo.inp), McBride, Zehe & Gordon, NASA TP-2002-211556',
    species,
  }),
);
console.log(`wrote ${species.length} species -> ${dest}`);
