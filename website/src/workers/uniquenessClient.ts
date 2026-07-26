import * as Comlink from "comlink";
import type { CountryModel } from "../model/copula";
import type { UniquenessApi } from "./uniqueness.worker";

export type UniquenessClient = {
  init(model: CountryModel, population: number): Promise<void>;
  compute(record: number[], scales: number[], draws: number, seed: number): Promise<number>;
  dispose(): void; // Stops the worker and rejects anything still waiting for an answer
};

export const createUniquenessClient = (): UniquenessClient => {
  const worker = new Worker(new URL("./uniqueness.worker.ts", import.meta.url), { type: "module" });
  const api = Comlink.wrap<UniquenessApi>(worker);

  // A call whose worker goes away never settles on its own, so race each one
  // against a promise that only ever rejects.
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {}); // Nothing may be waiting when the worker stops
  worker.onerror = () => fail(new Error("uniqueness worker failed"));
  const orFail = <T>(call: Promise<T>) => Promise.race([call, failed]);

  return {
    init: (model, population) => orFail(api.init(model, population)),
    compute: (record, scales, draws, seed) => orFail(api.compute(record, scales, draws, seed)),
    dispose: () => {
      fail(new Error("uniqueness worker disposed"));
      api[Comlink.releaseProxy](); // Drops Comlink's own hold on the worker before it stops
      worker.terminate();
    },
  };
};
