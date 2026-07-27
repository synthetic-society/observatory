import type { CountryModel } from "../model/copula";

export type Option = {
  id: string;
  label: string;
  crowdLabel: string; // How many people share this answer, as text: "2.4M", "310k".
  index: number;
  share: number;
};

export type Question = {
  id: string;
  attr: string;
  kind: "single" | "dob_year" | "dob_month" | "dob_day";
  title: string;
  blurb?: string;
  options: Option[];
};

export type QuizStep = {
  id: string;
  title: string;
  blurb?: string;
  kind: "single" | "dob";
  questionIds: string[];
};

export type Quiz = {
  model: CountryModel;
  iso3: string;
  countryName: string;
  population: number;
  questions: Question[];
  steps: QuizStep[];
  resultLabels: Record<string, string>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = new Date().getFullYear();

const validYear = (year: number): boolean => Number.isInteger(year) && year >= 1900 && year <= CURRENT_YEAR;
const validMonth = (month: number): boolean => Number.isInteger(month) && month >= 1 && month <= 12;
const daysInMonth = (year: number, month: number): number =>
  new Date(validYear(year) ? year : 2001, month, 0).getDate();
const validDay = (year: number, month: number, day: number): boolean => {
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  if (!validMonth(month)) return day <= 31;
  return day <= daysInMonth(year, month);
};

const ageToday = (year: number, month: number, day: number): number => {
  const now = new Date();
  let age = now.getFullYear() - year;
  const monthsToBirthday = now.getMonth() + 1 - month;
  if (monthsToBirthday < 0 || (monthsToBirthday === 0 && now.getDate() < day)) age--;
  return Math.max(0, Math.min(100, age));
};

const readNum = (text: string | undefined): number => {
  if (text == null || text === "") return Number.NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
};

export const isValidDob = (answers: Record<string, string>): boolean => {
  const year = readNum(answers.dob_year);
  const month = readNum(answers.dob_month);
  const day = readNum(answers.dob_day);
  return validYear(year) && validMonth(month) && validDay(year, month, day);
};

const crowdLabel = (population: number, share: number) => {
  const people = share * population;
  if (people >= 1e6) return `${(people / 1e6).toFixed(1)}M`;
  if (people >= 1e3) return `${(people / 1e3).toFixed(0)}k`;
  if (people >= 1) return `${Math.round(people)}`;
  return `< 1`;
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "x";

const QUESTION_TEXT: Record<string, { title: string; blurb?: string; resultLabel: string }> = {
  "Home location": { title: "Where do you live?", resultLabel: "Home location" },
  Sex: {
    title: "What's your legal sex?",
    blurb: "Census records sex as a binary and we follow that schema here.",
    resultLabel: "Sex",
  },
  "Marital status": { title: "What's your marital status?", resultLabel: "Marital status" },
  Religion: { title: "What is your religion?", resultLabel: "Religion" },
  Race: { title: "How would you describe your ethnicity?", resultLabel: "Ethnicity" },
  Employment: {
    title: "Are you currently employed?",
    blurb: "Census employment status.",
    resultLabel: "Employment",
  },
  "Children born": {
    title: "How many children have you given birth to?",
    resultLabel: "Children born",
  },
  Education: {
    title: "What's your highest level of education?",
    resultLabel: "Education",
  },
};

const AGE_ATTR = "Age";

const SKIPPED_ATTRS = new Set(["Urban/rural"]); // In the models but never asked about for now

// Each country's model stores its own set of ages rather than every year from 0
// to 100: the UK has [17,22,27,…], others list every year in a range. Find the
// closest age the model knows about and return where it sits in that list, which
// is what both the share lookup and the model expect.
const ageIndex = (model: CountryModel, age: number): number => {
  const ages = model.marginals[AGE_ATTR]?.uniqVals;
  if (!ages || ages.length === 0) return Number.NaN;
  return ages.reduce(
    (closest, value, index) =>
      Math.abs(Number(value) - age) < Math.abs(Number(ages[closest]) - age) ? index : closest,
    0,
  );
};

// How many birth years one age entry stands for: a band midpoint covers half the
// gap to each neighbour, an every-year listing gives 1.
const ageSpanYears = (model: CountryModel, age: number): number => {
  const ages = model.marginals[AGE_ATTR]?.uniqVals;
  const index = ageIndex(model, age);
  if (!ages || ages.length < 2 || Number.isNaN(index)) return 1;
  const lo = Math.max(index - 1, 0);
  const hi = Math.min(index + 1, ages.length - 1);
  return (Number(ages[hi]) - Number(ages[lo])) / (hi - lo);
};

/** Share of the country born in one particular year, for someone of this age. */
export const ageShare = (model: CountryModel, age: number): number =>
  (model.marginals[AGE_ATTR]?.probs[ageIndex(model, age)] ?? 1) / ageSpanYears(model, age);

const buildOptions = (attr: string, model: CountryModel, population: number): Option[] => {
  const marginal = model.marginals[attr];
  if (!marginal) return [];
  return marginal.uniqVals.map((value, i) => ({
    id: slugify(String(value)) || `i${i}`,
    label: String(value),
    crowdLabel: crowdLabel(population, marginal.probs[i] ?? 0),
    index: i,
    share: marginal.probs[i] ?? 0,
  }));
};

const dedupeOptionIds = (options: Option[]): Option[] => {
  const seen = new Map<string, number>();
  return options.map((option) => {
    const count = (seen.get(option.id) ?? 0) + 1;
    seen.set(option.id, count);
    return count === 1 ? option : { ...option, id: `${option.id}_${count}` };
  });
};

export const buildQuiz = (model: CountryModel, iso3: string): Quiz => {
  const countryName = model.name ?? iso3;
  const population = model.pop_num ?? 1;

  const questions: Question[] = [];
  const steps: QuizStep[] = [];
  const resultLabels: Record<string, string> = {};

  // We use the same order of attributes throughout
  for (const attr of model.avail_var) {
    if (SKIPPED_ATTRS.has(attr)) continue;
    if (attr === AGE_ATTR) {
      const fields = [
        ["dob_year", "Age", "Birth year"],
        ["dob_month", "Birth month", "Birth month"],
        ["dob_day", "Birth day", "Birth day"],
      ] as const;
      questions.push(
        ...fields.map(([id, fieldAttr, title]) => ({
          id,
          attr: fieldAttr,
          kind: id,
          title,
          options: [],
        })),
      );
      steps.push({
        id: "dob",
        title: "What's your date of birth?",
        kind: "dob",
        questionIds: ["dob_year", "dob_month", "dob_day"],
      });
      Object.assign(resultLabels, Object.fromEntries(fields.map(([id, , title]) => [id, title])));
      continue;
    }

    const copy = QUESTION_TEXT[attr] ?? { title: attr, resultLabel: attr };
    const id = slugify(attr);
    const options = dedupeOptionIds(buildOptions(attr, model, population));
    if (options.length === 0) continue;
    questions.push({
      id,
      attr,
      kind: "single",
      title: copy.title,
      blurb: copy.blurb,
      options,
    });
    steps.push({ id, title: copy.title, blurb: copy.blurb, kind: "single", questionIds: [id] });
    resultLabels[id] = copy.resultLabel;
  }

  return { model, iso3, countryName, population, questions, steps, resultLabels };
};

export const isAnswered = (question: Question, answer: string | undefined): boolean => {
  if (answer == null || answer === "") return false;
  if (question.kind === "dob_year") return validYear(readNum(answer));
  if (question.kind === "dob_month") return validMonth(readNum(answer));
  if (question.kind === "dob_day") {
    const day = readNum(answer);
    return Number.isInteger(day) && day >= 1 && day <= 31;
  }
  return question.options.some((option) => option.id === answer);
};

const answeredAge = (answers: Record<string, string>): number => {
  const year = readNum(answers.dob_year);
  const givenMonth = readNum(answers.dob_month);
  const givenDay = readNum(answers.dob_day);
  const month = validMonth(givenMonth) ? givenMonth : 1;
  const day = validDay(year, month, givenDay) ? givenDay : 1;
  return ageToday(year, month, day);
};

/** Share of the country giving the same answer, or 1 if the question is unanswered. */
export const computeShare = (quiz: Quiz, question: Question, answers: Record<string, string>): number => {
  const answer = answers[question.id];
  if (!isAnswered(question, answer)) return 1;
  if (question.kind === "dob_year") return ageShare(quiz.model, answeredAge(answers));
  if (question.kind === "dob_month") return 1 / 12;
  if (question.kind === "dob_day") {
    const month = readNum(answers.dob_month);
    return 1 / daysInMonth(readNum(answers.dob_year), validMonth(month) ? month : 1);
  }
  return question.options.find((option) => option.id === answer)?.share ?? 1;
};

const answerIndex = (model: CountryModel, question: Question, answers: Record<string, string>): number => {
  if (question.kind === "dob_year") {
    if (!validYear(readNum(answers.dob_year))) return Number.NaN;
    return ageIndex(model, answeredAge(answers));
  }
  const answer = answers[question.id];
  if (!isAnswered(question, answer)) return Number.NaN;
  return question.options.find((option) => option.id === answer)?.index ?? Number.NaN;
};

export const answerDisplay = (
  quiz: Quiz,
  question: Question,
  answers: Record<string, string>,
): { label: string; crowdLabel: string } => {
  const answer = answers[question.id];
  if (!isAnswered(question, answer)) return { label: "—", crowdLabel: "" };
  if (question.kind === "single") {
    const option = question.options.find((candidate) => candidate.id === answer);
    return { label: option?.label ?? "—", crowdLabel: option?.crowdLabel ?? "" };
  }
  const number = readNum(answer);
  return {
    label: question.kind === "dob_month" ? MONTHS[number - 1] : String(number),
    crowdLabel: crowdLabel(quiz.population, computeShare(quiz, question, answers)),
  };
};

export const answerIndices = (
  quiz: Quiz,
  answers: Record<string, string>,
  enabled: Record<string, boolean>,
): number[] =>
  quiz.model.avail_var.map((attr) => {
    const question = quiz.questions.find((candidate) => candidate.attr === attr);
    if (!question || enabled[question.id] === false) return Number.NaN;
    return answerIndex(quiz.model, question, answers);
  });

export const shareScales = (quiz: Quiz, answers: Record<string, string>, enabled: Record<string, boolean>): number[] =>
  quiz.model.avail_var.map((attr) => {
    const question = quiz.questions.find((candidate) => candidate.attr === attr);
    if (question?.kind !== "dob_year") return 1;
    const year = readNum(answers.dob_year);
    const month = readNum(answers.dob_month);
    const day = readNum(answers.dob_day);
    if (!validYear(year)) return 1;
    let scale = 1 / ageSpanYears(quiz.model, answeredAge(answers));
    if (enabled.dob_month !== false && validMonth(month)) scale /= 12;
    if (enabled.dob_day !== false && validDay(year, month, day)) {
      scale /= daysInMonth(year, validMonth(month) ? month : 1);
    }
    return scale;
  });

export const crowdRemaining = (quiz: Quiz, answers: Record<string, string>): number => {
  let remaining = quiz.population;
  for (const question of quiz.questions) remaining *= computeShare(quiz, question, answers);
  return Math.max(1, Math.round(remaining));
};
