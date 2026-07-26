import * as Comlink from "comlink";
import { type CountryModel, GaussianCopula, indivUniqueness } from "../model/copula";
import { loadMvndst, type MvndstModule } from "../model/mvndst";

type Loaded = { wasm: MvndstModule; copula: GaussianCopula; population: number };

// Held as a promise so a compute arriving while init is still loading the
// WebAssembly module waits for it instead of failing.
let loaded: Promise<Loaded> | null = null;

const api = {
  async init(model: CountryModel, population: number): Promise<void> {
    loaded = loadMvndst().then((wasm) => ({ wasm, copula: new GaussianCopula(model), population }));
    await loaded;
  },

  async compute(record: number[], scales: number[], draws: number, seed: number): Promise<number> {
    if (!loaded) throw new Error("uniqueness worker used before init");
    const { wasm, copula, population } = await loaded;
    return indivUniqueness(wasm, copula, record, population, { draws, seed, scales }).uniqueness;
  },
};

export type UniquenessApi = typeof api;

Comlink.expose(api);
