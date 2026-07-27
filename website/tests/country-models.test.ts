import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CountryModel } from "../src/model/copula";

const root = resolve(import.meta.dir, "..");
const GBR: CountryModel = JSON.parse(readFileSync(resolve(root, "src/data/country_models/GBR.json"), "utf8"));

const commonest = (attr: string): string | number => {
  const { probs, uniqVals } = GBR.marginals[attr];
  return uniqVals[probs.indexOf(Math.max(...probs))];
};

describe("shipped country models", () => {
  // Shares attached to the wrong answers still sum to one, so only known facts about the country catch them.
  test("GBR shares sit on the answers they belong to", () => {
    expect(commonest("Religion")).toBe("Christian");
    expect(commonest("Race")).toBe("White");
    expect(commonest("Age")).toBe(37); // Midpoint of 30–44, the widest UK age band
  });
});
