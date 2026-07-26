import { callMvndst, type MvndstModule } from "./mvndst";
import { mulberry32, normInv } from "./stats";

export type Marginal = { probs: number[]; uniqVals: (string | number)[] };

export type CountryModel = {
  iso3?: string;
  name?: string;
  avail_var: string[];
  pop_num: number | null;
  corr: number[][];
  marginals: Record<string, Marginal>;
};

export class GaussianCopula {
  readonly corr: number[][];
  readonly marginals: Marginal[];
  readonly names: string[];
  constructor(model: CountryModel) {
    this.names = model.avail_var;
    this.corr = model.corr;
    this.marginals = this.names.map((name) => model.marginals[name]);
  }
  marginal(name: string): Marginal {
    const i = this.names.indexOf(name);
    if (i < 0) throw new Error(`unknown attribute ${name}`);
    return this.marginals[i];
  }
}

/**
 * Chance that one person drawn at random from the population has the same
 * answers as `record` (one value index per attribute).
 */
export const probOfMatch = (
  wasm: MvndstModule,
  copula: GaussianCopula,
  record: number[],
  opts: { draws?: number; seed?: number; scales?: number[] } = {},
): number => {
  const { draws = 50, seed = 1, scales } = opts;
  const attributeCount = record.length;
  const widths = new Array<number>(attributeCount);
  for (let i = 0; i < attributeCount; i++) {
    widths[i] = Number.isNaN(record[i]) ? 0 : (copula.marginals[i].probs[record[i]] ?? Number.NaN);
    if (scales) widths[i] *= scales[i];
  }
  const random = mulberry32(seed);
  let sum = 0;
  // The copula is continuous, so each answer covers a slice as wide as its
  // share of the population. Where that slice sits is arbitrary, so we average
  // over random placements instead of picking one.
  for (let draw = 0; draw < draws; draw++) {
    const lower = new Array<number>(attributeCount);
    const upper = new Array<number>(attributeCount);
    for (let j = 0; j < attributeCount; j++) {
      const start = random() * (1 - widths[j]);
      if (Number.isNaN(record[j])) {
        lower[j] = -Infinity;
        upper[j] = Infinity;
      } else {
        lower[j] = normInv(start);
        upper[j] = normInv(start + widths[j]);
      }
    }
    sum += callMvndst(wasm, lower, upper, copula.corr);
  }
  return sum / draws;
};

/** Chance that nobody else among `population` people has the same answers. */
export const indivUniqueness = (
  wasm: MvndstModule,
  copula: GaussianCopula,
  record: number[],
  population: number,
  opts?: { draws?: number; seed?: number; scales?: number[] },
): { uniqueness: number; matchProb: number } => {
  const matchProb = probOfMatch(wasm, copula, record, opts);
  return { uniqueness: (1 - matchProb) ** (population - 1), matchProb };
};
