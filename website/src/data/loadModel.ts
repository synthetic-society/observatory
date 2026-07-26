import * as z from "zod/mini";
import type { CountryModel } from "../model/copula";
import countryIndex from "./country_models/countries.json";

// The models are written by the pre-training pipeline, so check a downloaded
// file really has the shape the copula expects before handing it over.
const countryModelSchema = z.object({
  iso3: z.optional(z.string()),
  name: z.optional(z.string()),
  avail_var: z.array(z.string()),
  pop_num: z.nullable(z.number()),
  corr: z.array(z.array(z.number())),
  marginals: z.record(
    z.string(),
    z.object({ probs: z.array(z.number()), uniqVals: z.array(z.union([z.string(), z.number()])) }),
  ),
});

// Collect the URL of every country model, so the browser downloads only the country someone picked
const MODEL_URLS = import.meta.glob<string>(
  ["./country_models/*.json", "!./country_models/manifest.json", "!./country_models/countries.json"],
  {
    eager: true,
    import: "default",
    query: "?url&no-inline",
  },
);

// Keyed by the file name without ".json", that is the ISO3 country code
const urlByCountry: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_URLS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -5), url]),
);

type CountryEntry = {
  iso3: string;
  name: string;
};

export const availableCountries: CountryEntry[] = [...countryIndex.countries].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const cache = new Map<string, Promise<CountryModel>>();

export const loadCountryModel = (iso3: string): Promise<CountryModel> => {
  const key = iso3.toUpperCase();
  const url = urlByCountry[key];
  if (!url) return Promise.reject(new Error(`No model available for country "${iso3}"`));

  const cached = cache.get(key);
  if (cached) return cached;
  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load the ${key} country model`);
      const model: CountryModel = countryModelSchema.parse(await response.json());
      return model;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, request);
  return request;
};

export const hasCountryModel = (iso3: string): boolean => iso3.toUpperCase() in urlByCountry;

export const DEFAULT_COUNTRY = "GBR";
