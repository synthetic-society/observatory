import createMvndst, { type MvndstModule } from "./generated/mvndst.mjs";

export type { MvndstModule };

// Written as a literal URL so the bundler copies the .wasm file into the build,
// and so Bun loads it straight from disk in tests.
const wasmUrl = new URL("./generated/mvndst.wasm", import.meta.url).href;

let cached: Promise<MvndstModule> | null = null;

export const loadMvndst = (): Promise<MvndstModule> => {
  cached ??= createMvndst({ locateFile: () => wasmUrl }).catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
};

/**
 * MVNDST: probability that a draw from a normal distribution with correlation `corr` lands
 * between `lower` and `upper` on every axis.
 */
export const callMvndst = (
  wasm: MvndstModule,
  lower: number[],
  upper: number[],
  corr: number[][],
  maxpts = 2000,
  abseps = 1e-6,
  releps = 1e-6,
): number => {
  const flat: number[] = [];
  for (let i = 0; i < lower.length; i++) for (let j = 0; j < i; j++) flat.push(corr[i][j]);
  const lowerPtr = alloc(wasm, lower);
  const upperPtr = alloc(wasm, upper);
  const corrPtr = alloc(wasm, flat);
  try {
    return wasm._mvndst_cdf(lower.length, lowerPtr, upperPtr, corrPtr, maxpts, abseps, releps);
  } finally {
    wasm._free(lowerPtr);
    wasm._free(upperPtr);
    wasm._free(corrPtr);
  }
};

const alloc = (wasm: MvndstModule, values: number[]): number => {
  const ptr = wasm._malloc(values.length * 8);
  wasm.HEAPF64.set(values, ptr / 8);
  return ptr;
};
