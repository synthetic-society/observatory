import { signal } from "@preact/signals";
import * as z from "zod/mini";
import { DEFAULT_COUNTRY, hasCountryModel, loadCountryModel } from "../data/loadModel";
import { buildQuiz, crowdRemaining as crowdRemainingFor, type Quiz } from "../data/quiz";

const ANSWERS_KEY = "ooa.answers";
const COUNTRY_KEY = "ooa.country";

// Answers come back from session storage, where anything could have been left.
const answersSchema = z.record(z.string(), z.string());

const resolveCountry = (iso3: string | null | undefined): string => {
  if (iso3 && hasCountryModel(iso3)) return iso3.toUpperCase();
  return DEFAULT_COUNTRY;
};

const urlCountry = ((): string | null => {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("country");
})();

const initialCountry = ((): string => {
  if (urlCountry) return resolveCountry(urlCountry);
  if (typeof window === "undefined") return DEFAULT_COUNTRY;
  return resolveCountry(sessionStorage.getItem(COUNTRY_KEY));
})();

export const activeCountry = signal<string>(initialCountry);
export const answers = signal<Record<string, string>>({});
export const currentIndex = signal(0);
export const quiz = signal<Quiz | null>(null);
export const quizError = signal(false);

// Skip the first step of the quiz (“which country?”) if a `?country=` parameter is present in the URL
export const countryChosen = signal<boolean>(!!urlCountry && hasCountryModel(urlCountry));

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
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(COUNTRY_KEY, next);
    sessionStorage.removeItem(ANSWERS_KEY);
  }
};

// Confirm the country step and move on to the country's questions.
export const chooseCountry = (iso3: string) => {
  setCountry(iso3);
  currentIndex.value = 0;
  countryChosen.value = true;
};

// Back out of the first question to re-pick the country.
export const editCountry = () => {
  countryChosen.value = false;
  currentIndex.value = 0;
};

export const setAnswer = (questionId: string, optionId: string) => {
  answers.value = { ...answers.value, [questionId]: optionId };
};

export const submitAnswers = () => {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(answers.value));
    sessionStorage.setItem(COUNTRY_KEY, activeCountry.value);
  }
};

export const loadAnswers = (): Record<string, string> => {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const stored = answersSchema.safeParse(JSON.parse(sessionStorage.getItem(ANSWERS_KEY) ?? "{}"));
    return stored.success ? stored.data : {};
  } catch {
    return {};
  }
};

export const reset = () => {
  answers.value = {};
  currentIndex.value = 0;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(ANSWERS_KEY);
};

export const crowdRemaining = (answers: Record<string, string>) =>
  quiz.value ? crowdRemainingFor(quiz.value, answers) : 0;

if (typeof window !== "undefined") void loadQuiz(initialCountry).catch(() => undefined);
