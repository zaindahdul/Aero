"""
Generate validation fixtures from NASA CEA (via RocketCEA, which wraps the
original Gordon & McBride Fortran).  The TypeScript equilibrium solver in
src/core/thermo is tested against this file.

    pip install rocketcea
    python scripts/reference/cea_reference.py

Writes tests/fixtures/cea_reference.json (SI units).
"""
import json
import os

from rocketcea.cea_obj import CEA_Obj

PSIA = 6894.757293168
R_TO_K = 5.0 / 9.0
FT = 0.3048
BTU_LBM_R = 4186.8  # J/(kg K)
LBM_FT3 = 16.01846337

# (oxidizer card, fuel card, our propellant ids, list of O/F, list of Pc [psia], list of eps)
CASES = [
    ("LOX", "LH2", ("LOX", "LH2"), [4.0, 5.0, 6.0, 7.0], [300.0, 1000.0, 3000.0], [10.0, 40.0, 80.0]),
    ("LOX", "CH4", ("LOX", "LCH4"), [2.6, 3.2, 3.6], [500.0, 1500.0, 4000.0], [15.0, 40.0]),
    ("LOX", "RP1", ("LOX", "RP1"), [2.0, 2.6, 3.0], [500.0, 1500.0, 3500.0], [15.0, 40.0]),
    ("N2O4", "MMH", ("N2O4", "MMH"), [1.65, 2.0], [150.0, 1000.0], [40.0, 150.0]),
    ("LOX", "Ethanol", ("LOX", "ETHANOL"), [1.3, 1.6], [300.0, 1000.0], [8.0, 25.0]),
    ("N2O", "Ethanol", ("N2O", "ETHANOL"), [4.0, 5.5], [400.0], [6.0, 20.0]),
    ("90_H2O2", "RP1", ("H2O2_90", "RP1"), [6.5, 7.5], [500.0], [12.0, 40.0]),
]


def run_case(ox, fu, ids, mr, pc, eps):
    c = CEA_Obj(oxName=ox, fuelName=fu)
    out = {"ox": ids[0], "fuel": ids[1], "of": mr, "pc": pc * PSIA, "eps": eps}
    for frozen in (0, 1):
        key = "frozen" if frozen else "equilibrium"
        temps = c.get_Temperatures(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        sonic = c.get_SonicVelocities(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        dens = c.get_Densities(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        mw_c, gam_c = c.get_Chamber_MolWt_gamma(Pc=pc, MR=mr, eps=eps)
        mw_t, gam_t = c.get_Throat_MolWt_gamma(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        mw_e, gam_e = c.get_exit_MolWt_gamma(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        out[key] = {
            "Tc": temps[0] * R_TO_K,
            "Tt": temps[1] * R_TO_K,
            "Te": temps[2] * R_TO_K,
            "cstar": c.get_Cstar(Pc=pc, MR=mr) * FT,
            "ispVac": c.get_Isp(Pc=pc, MR=mr, eps=eps, frozen=frozen),
            "pcOverPe": c.get_PcOvPe(Pc=pc, MR=mr, eps=eps, frozen=frozen),
            "pcOverPt": c.get_Throat_PcOvPe(Pc=pc, MR=mr),
            "machExit": c.get_MachNumber(Pc=pc, MR=mr, eps=eps, frozen=frozen),
            "aChamber": sonic[0] * FT,
            "aThroat": sonic[1] * FT,
            "aExit": sonic[2] * FT,
            "rhoChamber": dens[0] * LBM_FT3,
            "mwChamber": mw_c,
            "gammaChamber": gam_c,
            "mwThroat": mw_t,
            "gammaThroat": gam_t,
            "mwExit": mw_e,
            "gammaExit": gam_e,
        }
    def transport(fn, frozen):
        cp, visc, cond, pr = fn(Pc=pc, MR=mr, eps=eps, frozen=frozen)
        return {
            "cp": cp * 4184.0,  # CEA transport printout is cal/(g K)
            "viscosity": visc * 1e-4,  # millipoise -> Pa s
            "conductivity": cond * 1e-3 * 4.184 * 100.0,  # mcal/(cm s K) -> W/(m K)
            "prandtl": pr,
        }

    out["chamberTransport"] = transport(c.get_Chamber_Transport, 0)
    out["chamberTransportFrozen"] = transport(c.get_Chamber_Transport, 1)
    out["throatTransportFrozen"] = transport(c.get_Throat_Transport, 1)
    out["exitTransportFrozen"] = transport(c.get_Exit_Transport, 1)
    mf = c.get_SpeciesMoleFractions(Pc=pc, MR=mr, eps=eps, frozen=0, min_fraction=1e-5)
    # mf -> (molWtD, moleFracD); moleFracD[name] = [chamber, throat, exit]
    out["chamberMoleFractions"] = {k.strip("*"): v[1] for k, v in mf[1].items() if v[1] > 1e-5}
    return out


def main():
    cases = []
    for ox, fu, ids, mrs, pcs, epss in CASES:
        for mr in mrs:
            for pc in pcs:
                for eps in epss:
                    cases.append(run_case(ox, fu, ids, mr, pc, eps))
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "..", "..", "tests", "fixtures", "cea_reference.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump({"source": "NASA CEA via RocketCEA", "cases": cases}, f, indent=1)
    print(f"wrote {len(cases)} cases -> {os.path.normpath(dest)}")


if __name__ == "__main__":
    main()
