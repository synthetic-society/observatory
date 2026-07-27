import { effect, signal } from "@preact/signals";
import * as z from "zod/mini";
import { DEFAULT_COUNTRY, hasCountryModel, loadCountryModel } from "../data/loadModel";
import { buildQuiz, crowdRemaining as crowdRemainingFor, type Quiz } from "../data/quiz";

const DRAFT_KEY = "ooa.draft";

const draftSchema = z.object({
  country: z.string(),
  chosen: z.boolean(),
  index: z.number(),
  answers: z.record(z.string(), z.string()),
});
type Draft = z.infer<typeof draftSchema>;

const session = typeof sessionStorage === "undefined" ? null : sessionStorage;

const resolveCountry = (iso3: string | null | undefined): string => {
  if (iso3 && hasCountryModel(iso3)) return iso3.toUpperCase();
  return DEFAULT_COUNTRY;
};

const readDraft = (): Draft | null => {
  try {
    const stored = draftSchema.safeParse(JSON.parse(session?.getItem(DRAFT_KEY) ?? "null"));
    return stored.success ? stored.data : null;
  } catch {
    return null;
  }
};

const urlCountry = ((): string | null => {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("country");
})();

const draft = readDraft();
const initialCountry = resolveCountry(urlCountry ?? draft?.country);
const resumed = draft?.country === initialCountry ? draft : null;

export const activeCountry = signal<string>(initialCountry);
export const answers = signal<Record<string, string>>(resumed?.answers ?? {});
export const currentIndex = signal(resumed?.index ?? 0);
export const quiz = signal<Quiz | null>(null);
export const quizError = signal(false);

// Skip the first step of the quiz (“which country?”) if a `?country=` parameter is present in the URL
export const countryChosen = signal<boolean>(resumed?.chosen ?? (!!urlCountry && hasCountryModel(urlCountry)));

let pendingQuiz: Promise<Quiz> | null = null;

const loadQuiz = (iso3: string): Promise<Quiz> => {
  const country = resolveCountry(iso3);
  activeCountry.value = country;
  quiz.value = null;
  quizError.value = false;
  pendingQuiz = loadCountryModel(country)
    .then((model) => {
      const loaded = buildQuiz(model, country);
      if (activeCountry.value === country) quiz.value = loaded;
      return loaded;
    })
    .catch((error) => {
      if (activeCountry.value === country) {
        pendingQuiz = null;
        quizError.value = true;
      }
      throw error;
    });
  return pendingQuiz;
};

export const getQuiz = (): Promise<Quiz> => {
  if (quiz.value) return Promise.resolve(quiz.value);
  return pendingQuiz ?? loadQuiz(activeCountry.value);
};

const setCountry = (iso3: string) => {
  const next = resolveCountry(iso3);
  if (next === activeCountry.value) {
    if (!quiz.value && !pendingQuiz) void loadQuiz(next).catch(() => undefined);
    return;
  }
  answers.value = {};
  currentIndex.value = 0;
  void loadQuiz(next).catch(() => undefined);
};

const pushStep = () => {
  if (typeof history !== "undefined") {
    history.pushState({ chosen: countryChosen.value, index: currentIndex.value }, "");
  }
};

export const goToStep = (index: number) => {
  currentIndex.value = index;
  pushStep();
};

export const chooseCountry = (iso3: string) => {
  setCountry(iso3);
  currentIndex.value = 0;
  countryChosen.value = true;
  pushStep();
};

export const editCountry = () => {
  countryChosen.value = false;
  currentIndex.value = 0;
  pushStep();
};

export const setAnswer = (questionId: string, optionId: string) => {
  answers.value = { ...answers.value, [questionId]: optionId };
};

export const loadAnswers = (): Record<string, string> => readDraft()?.answers ?? {};

export const reset = () => {
  answers.value = {};
  currentIndex.value = 0;
};

export const crowdRemaining = (answers: Record<string, string>) =>
  quiz.value ? crowdRemainingFor(quiz.value, answers) : 0;

if (typeof window !== "undefined") {
  history.replaceState({ chosen: countryChosen.value, index: currentIndex.value }, "");
  window.addEventListener("popstate", (event) => {
    const state = event.state as { chosen?: boolean; index?: number } | null;
    if (!state) return;
    countryChosen.value = !!state.chosen;
    currentIndex.value = state.index ?? 0;
  });

  // Keep the draft current so a reload, or Back from the result, resumes where the quiz left off.
  effect(() => {
    const current: Draft = {
      country: activeCountry.value,
      chosen: countryChosen.value,
      index: currentIndex.value,
      answers: answers.value,
    };
    try {
      session?.setItem(DRAFT_KEY, JSON.stringify(current));
    } catch {
      // Storage can be full or blocked; the quiz still works, it just will not resume.
    }
  });

  void loadQuiz(initialCountry).catch(() => undefined);
}
