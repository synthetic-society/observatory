import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CountryModel, GaussianCopula, indivUniqueness, probOfMatch } from "../src/model/copula";
import { callMvndst, loadMvndst } from "../src/model/mvndst";
import { normCdf, normInv } from "../src/model/stats";

const root = resolve(import.meta.dir, "..");
const wasm = await loadMvndst();
const GBR: CountryModel = JSON.parse(readFileSync(resolve(root, "src/data/country_models/GBR.json"), "utf8"));
const copula = new GaussianCopula(GBR);

describe("stats", () => {
  test("normCdf and normInv are inverse", () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
    }
  });
  test("normCdf bounds", () => {
    expect(normCdf(-5)).toBeLessThan(1e-5);
    expect(normCdf(5)).toBeGreaterThan(1 - 1e-5);
  });
});

describe("mvndst module", () => {
  test("Module loads with _malloc and _mvndst_cdf", () => {
    expect(typeof wasm._malloc).toBe("function");
    expect(typeof wasm._mvndst_cdf).toBe("function");
  });
  // Two independent axes, both above zero: a quarter of the draws.
  test("two independent variables give 1/4", () => {
    const p = callMvndst(
      wasm,
      [0, 0],
      [Infinity, Infinity],
      [
        [1, 0],
        [0, 1],
      ],
    );
    expect(p).toBeCloseTo(0.25, 3);
  });
  // Sheppard's formula gives 1/4 + arcsin(0.5) / (2 pi) = 1/3.
  test("two variables correlated 0.5 give 1/3", () => {
    const p = callMvndst(
      wasm,
      [0, 0],
      [Infinity, Infinity],
      [
        [1, 0.5],
        [0.5, 1],
      ],
    );
    expect(p).toBeCloseTo(1 / 3, 3);
  });
});

describe("GBR copula", () => {
  test("model has 7 attributes and population of 67M", () => {
    expect(copula.names.length).toBe(7);
    expect(GBR.pop_num ?? 0).toBeGreaterThan(60_000_000);
  });
  test("Marginal sums to ~1", () => {
    const shares = copula.marginal("Sex").probs.reduce((a, b) => a + b, 0);
    expect(shares).toBeCloseTo(1, 3);
  });
  test("probOfMatch returns a probability in (0,1)", () => {
    const middle = copula.names.map((name) => Math.floor(copula.marginal(name).probs.length / 2));
    const p = probOfMatch(wasm, copula, middle, { draws: 20 });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
  // A typical UK adult, keyed by attribute so the answers follow the model's own
  // order rather than one written out here.
  const PICK: Record<string, number | string> = {
    Age: 37,
    Employment: "Employed",
    "Home location": "Outer London, Inner London",
    "Marital status": "Married/in union",
    Race: "White",
    Religion: "Christian",
    Sex: "Female",
  };
  const adult = () => copula.names.map((name) => copula.marginal(name).uniqVals.indexOf(PICK[name]));

  test("indivUniqueness for a typical UK adult is between 0 and 1", () => {
    const record = adult();
    expect(record.every((i) => i >= 0)).toBe(true);
    const { uniqueness, matchProb } = indivUniqueness(wasm, copula, record, GBR.pop_num ?? 0, {
      draws: 20,
    });
    expect(matchProb).toBeGreaterThan(0);
    expect(uniqueness).toBeGreaterThanOrEqual(0);
    expect(uniqueness).toBeLessThanOrEqual(1);
  });
  test("removing attributes lowers uniqueness", () => {
    const full = adult();
    const partial = [...full];
    // Drop Age and Home location, wherever they sit in the model's order.
    partial[copula.names.indexOf("Age")] = Number.NaN;
    partial[copula.names.indexOf("Home location")] = Number.NaN;
    const population = GBR.pop_num ?? 0;
    const opts = { draws: 20, seed: 7 };
    const withAll = indivUniqueness(wasm, copula, full, population, opts).uniqueness;
    const withFewer = indivUniqueness(wasm, copula, partial, population, opts).uniqueness;
    expect(withFewer).toBeLessThanOrEqual(withAll + 1e-6);
  });
});
