"""
Tabulate coolant properties from CoolProp (reference Helmholtz-energy
equations of state and transport correlations) for the regenerative-cooling
model in src/core/thermal.

    pip install CoolProp
    python scripts/reference/build_fluid_tables.py

Writes src/core/fluids/data/coolprop-tables.json. Each property is a
row-major [P][T] Float32 grid, base64-encoded.
"""
import base64
import json
import math
import os
import struct

import CoolProp.CoolProp as CP

# id, CoolProp name, Tmin, Tmax [K], label
FLUIDS = [
    ("hydrogen", "ParaHydrogen", 20.0, 1000.0, "Hydrogen (para)"),
    ("methane", "Methane", 92.0, 625.0, "Methane"),
    ("rp1", "n-Dodecane", 265.0, 700.0, "RP-1 (n-dodecane surrogate)"),
    ("ethanol", "Ethanol", 200.0, 650.0, "Ethanol"),
    ("oxygen", "Oxygen", 60.0, 900.0, "Oxygen"),
    ("water", "Water", 275.0, 900.0, "Water"),
]
NT = 140
NP = 32
P_MIN, P_MAX = 1e5, 700e5
PROPS = {"rho": "D", "cp": "C", "mu": "V", "k": "L", "h": "H"}


def t_grid(tmin, tmax):
    # Clustered toward low temperature, where cryogenic properties vary fastest.
    return [tmin + (tmax - tmin) * (i / (NT - 1)) ** 1.5 for i in range(NT)]


def p_grid():
    return [math.exp(math.log(P_MIN) + (math.log(P_MAX) - math.log(P_MIN)) * j / (NP - 1)) for j in range(NP)]


def props_at(name, T, P):
    for dT in (0.0, 0.02, -0.02, 0.1, -0.1, 0.5):
        try:
            return {k: CP.PropsSI(code, "T", T + dT, "P", P, name) for k, code in PROPS.items()}
        except ValueError:
            continue
    return None  # outside the EOS range (e.g. near the melting line)


def pack(values):
    return base64.b64encode(struct.pack(f"<{len(values)}f", *values)).decode("ascii")


def main():
    out = {"source": f"CoolProp {CP.get_global_param_string('version')}", "fluids": {}}
    ps = p_grid()
    for fid, name, tmin, tmax, label in FLUIDS:
        ts = t_grid(tmin, tmax)
        grids = {k: [] for k in PROPS}
        filled = 0
        for P in ps:
            row = [props_at(name, T, P) for T in ts]
            # Fill invalid points from the nearest valid temperature in the row.
            for i, v in enumerate(row):
                if v is None:
                    filled += 1
                    j = min((j for j in range(NT) if row[j] is not None), key=lambda j: abs(j - i))
                    row[i] = row[j]
            for v in row:
                for k in PROPS:
                    grids[k].append(v[k])
        pc = CP.PropsSI("pcrit", name)
        tsat = []
        for P in ps:
            tsat.append(CP.PropsSI("T", "P", P, "Q", 0, name) if P < pc * 0.999 else float("nan"))
        out["fluids"][fid] = {
            "label": label,
            "coolprop": name,
            "T": ts,
            "P": ps,
            "Tcrit": CP.PropsSI("Tcrit", name),
            "Pcrit": pc,
            "molarMass": CP.PropsSI("molar_mass", name),
            "Tsat": [None if math.isnan(t) else t for t in tsat],
            **{k: pack(grids[k]) for k in PROPS},
        }
        print(f"{fid}: {len(ts)} x {len(ps)} ({filled} points outside EOS range filled)")
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "..", "..", "src", "core", "fluids", "data", "coolprop-tables.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f)
    print("wrote", os.path.normpath(dest), os.path.getsize(dest) // 1024, "KiB")


if __name__ == "__main__":
    main()
