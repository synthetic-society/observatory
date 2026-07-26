import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CountryModel, GaussianCopula, indivUniqueness } from "../src/model/copula";
import { loadMvndst } from "../src/model/mvndst";

// Reference values from CorrectMatch.jl, written by ../pre-training/src/gen_reference.py.
type Fixture = {
  model: CountryModel;
  cases: { indiv0: number[]; n: number; p_avg: number; uniqueness: number }[];
};

const DRAWS = 2000;
const PER_TEST_TIMEOUT_MS = 20_000;

const root = resolve(import.meta.dir, "..");
const wasm = await loadMvndst();
const fixture: Fixture = JSON.parse(readFileSync(resolve(root, "tests/fixtures/correctmatch_reference.json"), "utf8"));
const copula = new GaussianCopula(fixture.model);

describe("CorrectMatch reference parity", () => {
  for (const reference of fixture.cases) {
    test(
      `record ${JSON.stringify(reference.indiv0)} @ n=${reference.n}`,
      () => {
        const { uniqueness, matchProb } = indivUniqueness(wasm, copula, reference.indiv0, reference.n, {
          draws: DRAWS,
          seed: 12345,
        });
        const tolerance = 1e-4 + 0.1 * reference.p_avg;
        expect(Math.abs(matchProb - reference.p_avg)).toBeLessThan(tolerance);
        expect(uniqueness).toBeCloseTo(reference.uniqueness, 2);
      },
      PER_TEST_TIMEOUT_MS,
    );
  }
});
