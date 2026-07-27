import { useEffect, useState } from "preact/hooks";
import GBR from "../data/country_models/GBR.json";
import { ageShare } from "../data/quiz";
import type { CountryModel } from "../model/copula";
import DotField from "./DotField";

const POPULATION = GBR.pop_num ?? 67_330_000;
const CURRENT_YEAR = new Date().getFullYear();
const MODEL = GBR as unknown as CountryModel;

const shareOfValue = (attr: string, value: string | number): number => {
  const marginal = MODEL.marginals[attr];
  const i = marginal ? marginal.uniqVals.indexOf(value) : -1;
  return i >= 0 ? marginal.probs[i] : 0;
};

type Person = {
  sex: "Male" | "Female";
  bornYear?: number;
  location?: string;
  marital?: string;
  employment?: "Employed" | "Unemployed";
  race?: string;
};

const PEOPLE: Person[] = [
  {
    sex: "Male",
    marital: "Married/in union",
    bornYear: 1974,
    location: "South East",
    employment: "Employed",
  },
  {
    sex: "Female",
    marital: "Single/never married",
    bornYear: 1999,
    location: "Outer London, Inner London",
  },
  { sex: "Female", marital: "Married/in union", bornYear: 1990, location: "Scotland" },
  { sex: "Male", bornYear: 2004, location: "North West", employment: "Employed" },
  { sex: "Female", marital: "Widowed", bornYear: 1955, location: "Wales" },
  {
    sex: "Male",
    race: "Pakistani",
    marital: "Married/in union",
    bornYear: 1989,
    location: "West Midlands",
  },
  {
    sex: "Female",
    race: "Black African",
    bornYear: 1995,
    location: "Outer London, Inner London",
    employment: "Employed",
  },
  {
    sex: "Male",
    marital: "Single/never married",
    bornYear: 1999,
    location: "Yorkshire and the Humber",
    employment: "Unemployed",
  },
  {
    sex: "Female",
    marital: "Separated/divorced/spouse absent",
    bornYear: 1970,
    location: "East of England",
    employment: "Employed",
  },
  { sex: "Male", marital: "Married/in union", bornYear: 1960, location: "South West" },
  {
    sex: "Female",
    race: "Indian",
    marital: "Married/in union",
    bornYear: 1985,
    location: "East Midlands",
    employment: "Employed",
  },
  { sex: "Male", bornYear: 2008, location: "Northern Ireland" },
  {
    sex: "Female",
    marital: "Single/never married",
    bornYear: 2004,
    location: "North East",
    employment: "Employed",
  },
  {
    sex: "Male",
    race: "Chinese",
    bornYear: 1994,
    location: "Outer London, Inner London",
    employment: "Employed",
  },
  {
    sex: "Female",
    marital: "Married/in union",
    bornYear: 1974,
    location: "North West",
    employment: "Employed",
  },
  { sex: "Male", marital: "Single/never married", bornYear: 1999, location: "Wales" },
  {
    sex: "Female",
    marital: "Widowed",
    bornYear: 1959,
    location: "South East",
    employment: "Unemployed",
  },
  {
    sex: "Male",
    marital: "Married/in union",
    bornYear: 1989,
    location: "East of England",
    employment: "Employed",
  },
  {
    sex: "Female",
    marital: "Single/never married",
    bornYear: 1995,
    location: "Scotland",
    employment: "Employed",
  },
  {
    sex: "Male",
    marital: "Separated/divorced/spouse absent",
    bornYear: 1970,
    location: "Yorkshire and the Humber",
  },
];

const PLACE_NAME: Record<string, string> = {
  "North East": "the North East",
  "North West": "the North West",
  "Yorkshire and the Humber": "Yorkshire",
  "East Midlands": "the East Midlands",
  "West Midlands": "the West Midlands",
  "East of England": "the East of England",
  "South East": "the South East",
  "South West": "the South West",
  "Outer London, Inner London": "London",
  Scotland: "Scotland",
  Wales: "Wales",
  "Northern Ireland": "Northern Ireland",
};

const MARITAL_WORD: Record<string, string> = {
  "Single/never married": "single",
  "Married/in union": "married",
  "Separated/divorced/spouse absent": "divorced",
  Widowed: "widowed",
};

const ETHNICITY_WORD: Record<string, string> = {
  "Black African": "Black African",
  Indian: "Indian",
  Pakistani: "Pakistani",
  Chinese: "Chinese",
  Bangladeshi: "Bangladeshi",
};

const article = (word: string): string => ("aeiou".includes(word[0]?.toLowerCase()) ? "An" : "A");

// Describe someone in one sentence rather than a list of tags.
const describe = (person: Person): string => {
  const tail: string[] = [];
  if (person.bornYear) tail.push(`born in ${person.bornYear}`);
  if (person.location) tail.push(`living in ${PLACE_NAME[person.location] ?? person.location}`);
  if (person.employment) {
    tail.push(person.employment === "Unemployed" ? "out of work" : "in work");
  }

  const noun = person.sex === "Male" ? "man" : "woman";
  const adjectives = [
    person.marital ? MARITAL_WORD[person.marital] : null,
    person.race && person.race !== "White" ? ETHNICITY_WORD[person.race] : null,
  ].filter((value): value is string => value != null);
  const head = [...adjectives, noun].join(" ");
  return `${article(head)} ${head}${tail.length ? `, ${tail.join(", ")}` : ""}.`;
};

const crowdFor = (person: Person): number => {
  let share = 1;
  const attributes = [
    ["sex", "Sex"],
    ["marital", "Marital status"],
    ["location", "Home location"],
    ["race", "Race"],
    ["employment", "Employment"],
  ] as const;
  for (const [key, attribute] of attributes) {
    const value = person[key];
    if (value) share *= shareOfValue(attribute, value);
  }
  if (person.bornYear) share *= ageShare(MODEL, CURRENT_YEAR - person.bornYear);
  return Math.max(1, Math.round(POPULATION * share));
};

// Keep two digits so the count reads as an estimate ("about 57,000").
const roundToTwoDigits = (n: number): number => {
  if (n <= 0) return 0;
  const step = 10 ** (2 - Math.ceil(Math.log10(n + 1)));
  return Math.round(n * step) / step;
};

const PORTRAITS = PEOPLE.map((person, i) => ({
  sentence: describe(person),
  crowd: crowdFor(person),
  seed: 11 + i * 7,
}));

const fmt = (n: number) => n.toLocaleString("en-GB");
const INTERVAL = 4000;
const FADE = 350;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PortraitRotator() {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(true);
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let fadeTimer: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => {
      setShown(false);
      fadeTimer = setTimeout(() => {
        setIdx((i) => (i + 1) % PORTRAITS.length);
        setShown(true);
      }, FADE);
    }, INTERVAL);
    return () => {
      clearInterval(timer);
      clearTimeout(fadeTimer);
    };
  }, [reduced]);

  const portrait = PORTRAITS[idx];
  const fadeStyle = { transitionDuration: `${FADE}ms` };
  const fadeClass = `transition-opacity ${shown ? "opacity-100" : "opacity-0"}`;

  return (
    <div class="relative">
      <div class="absolute top-5 left-6 z-10">
        <p class="text-ink/70 text-sm">Population of the United Kingdom</p>
        <p class="font-medium font-serif text-3xl text-ink">{fmt(POPULATION)}</p>
      </div>

      <div class="absolute right-6 bottom-5 z-10 max-w-sm text-right">
        <p class={`text-balance text-base text-ink/85 leading-snug ${fadeClass}`} style={fadeStyle}>
          {portrait.sentence}
        </p>
        <p class={`mt-1 font-serif text-2xl text-accent-ink italic ${fadeClass}`} style={fadeStyle}>
          about {fmt(roundToTwoDigits(portrait.crowd))} people
        </p>
      </div>

      <div class={`h-105 ${fadeClass}`} style={fadeStyle}>
        <DotField variant="navy" crowd={portrait.crowd} seed={portrait.seed} />
      </div>
    </div>
  );
}
