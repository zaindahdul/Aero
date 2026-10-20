// Extracts viscosity / thermal-conductivity fits for C/H/O/N/Ar/He species
// (and their binary interaction viscosities) from the NASA CEA transport
// database trans.inp (Svehla 1995, NASA TM-4647; McBride et al.).
//
//   node scripts/build-transport.mjs path/to/trans.inp
//
// Each fit is ln(eta [uP]) or ln(lambda [uW/(cm K)]) = A ln T + B/T + C/T^2 + D.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-transport.mjs path/to/trans.inp');
  process.exit(1);
}
const lines = readFileSync(src, 'utf8').split(/\r?\n/);
const num = (s) => Number(s.trim().replace(/E\s+/i, 'E+').replace(/D/i, 'E'));
const allowed = /^(C|H|O|N|Ar|He|[CHON0-9()]+)$/;
const onlyCHON = (name) => {
  const elems = name.replace(/[^A-Za-z]/g, ' ').match(/[A-Z][a-z]?/g) ?? [];
  return elems.every((e) => ['C', 'H', 'O', 'N', 'Ar', 'He'].includes(e)) && allowed.test(name);
};

const species = {};
const binary = {};
let i = 1;
while (i < lines.length && !lines[i].startsWith('end')) {
  const h = lines[i];
  const a = h.slice(0, 16).trim();
  const b = h.slice(16, 32).trim();
  const code = h.slice(34, 38);
  const nv = Number(code[1]);
  const nc = Number(code[3]);
  const fits = { V: [], C: [] };
  for (let k = 1; k <= nv + nc; k++) {
    const l = lines[i + k];
    const kind = l[1];
    const [t1, t2] = l.slice(2, 20).trim().split(/\s+/).map(Number);
    fits[kind].push({
      tmin: t1,
      tmax: t2,
      c: [num(l.slice(20, 35)), num(l.slice(35, 50)), num(l.slice(50, 65)), num(l.slice(65, 80))],
    });
  }
  i += 1 + nv + nc;
  if (!onlyCHON(a) || (b && !onlyCHON(b))) continue;
  if (b) {
    if (fits.V.length) binary[`${a}|${b}`] = fits.V;
  } else {
    species[a] = fits;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src', 'core', 'thermo', 'data', 'nasa-transport.json');
writeFileSync(
  dest,
  JSON.stringify({ source: 'NASA CEA transport database (trans.inp), Svehla NASA TM-4647 and updates', species, binary }),
);
console.log(`wrote ${Object.keys(species).length} species, ${Object.keys(binary).length} binaries -> ${dest}`);
