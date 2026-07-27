import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildQuiz, computeShare } from "../src/data/quiz";
import type { CountryModel } from "../src/model/copula";

const root = resolve(import.meta.dir, "..");
const load = (iso3: string): CountryModel =>
  JSON.parse(readFileSync(resolve(root, `src/data/country_models/${iso3}.json`), "utf8"));

const shareForAge = (iso3: string, age: number): number => {
  const quiz = buildQuiz(load(iso3), iso3);
  const question = quiz.questions.find((candidate) => candidate.kind === "dob_year");
  if (!question) throw new Error(`${iso3} has no birth year question`);
  return computeShare(quiz, question, { dob_year: String(new Date().getFullYear() - age) });
};

describe("birth year shares", () => {
  // The UK stores age in bands, so the years inside one split its share instead of each claiming all of it.
  test("GBR birth years add up to the bands they cover", () => {
    let total = 0;
    for (let age = 20; age <= 69; age++) total += shareForAge("GBR", age);
    const covered = load("GBR").marginals.Age.probs.slice(1, 7); // Bands 22…67, which span ages 20–69
    expect(total).toBeCloseTo(
      covered.reduce((a, b) => a + b, 0),
      1,
    );
  });

  test("a country listing every year keeps that year's own share", () => {
    const age = load("FRA").marginals.Age;
    expect(shareForAge("FRA", 40)).toBe(age.probs[age.uniqVals.indexOf(40)]);
  });
});
