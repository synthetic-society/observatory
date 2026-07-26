import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CountryModel, GaussianCopula, indivUniqueness } from "../src/model/copula";
import { loadMvndst } from "../src/model/mvndst";
import { createUniquenessClient } from "../src/workers/uniquenessClient";

const root = resolve(import.meta.dir, "..");
const GBR: CountryModel = JSON.parse(readFileSync(resolve(root, "src/data/country_models/GBR.json"), "utf8"));
const population = GBR.pop_num ?? 0;
const middle = GBR.avail_var.map((attr) => Math.floor(GBR.marginals[attr].probs.length / 2));
const noScales = GBR.avail_var.map(() => 1);
const DRAWS = 20;

// MVNDST keeps some state of its own between calls, so the same request twice
// gives a very slightly different answer even with the same seed.
describe("uniqueness worker", () => {
  test("matches an in-process computation", async () => {
    const client = createUniquenessClient();
    try {
      await client.init(GBR, population);
      const viaWorker = await client.compute(middle, noScales, DRAWS, 42);
      const direct = indivUniqueness(await loadMvndst(), new GaussianCopula(GBR), middle, population, {
        draws: DRAWS,
        seed: 42,
        scales: noScales,
      }).uniqueness;
      expect(viaWorker).toBeCloseTo(direct, 6);
    } finally {
      client.dispose();
    }
  }, 30_000);

  test("pairs concurrent requests with their own results", async () => {
    const client = createUniquenessClient();
    try {
      await client.init(GBR, population);
      const oneLeftOut = middle.map((value, i) => (i === 0 ? Number.NaN : value));
      const [full, partial, again] = await Promise.all([
        client.compute(middle, noScales, DRAWS, 42),
        client.compute(oneLeftOut, noScales, DRAWS, 42),
        client.compute(middle, noScales, DRAWS, 42),
      ]);
      expect(again).toBeCloseTo(full, 6);
      expect(partial).toBeLessThanOrEqual(full);
    } finally {
      client.dispose();
    }
  }, 30_000);

  test("dispose rejects requests still in flight", async () => {
    const client = createUniquenessClient();
    await client.init(GBR, population);
    const pending = client.compute(middle, noScales, DRAWS, 42);
    client.dispose();
    await expect(pending).rejects.toThrow("disposed");
  }, 30_000);
});
