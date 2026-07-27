import { signal } from "@preact/signals";
import type { Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { availableCountries, DEFAULT_COUNTRY } from "../data/loadModel";
import { answerDisplay, isAnswered, isValidDob } from "../data/quiz";
import {
  activeCountry,
  answers,
  chooseCountry,
  countryChosen,
  crowdRemaining,
  currentIndex,
  editCountry,
  quizError,
  quiz as quizSignal,
  setAnswer,
  submitAnswers,
} from "../lib/store";
import DotField from "./DotField";
import Button from "./ui/Button";

const fmt = (n: number) => n.toLocaleString("en-US");
const onlyDigits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);

const countries = availableCountries;
const pickedCountry = signal<string>(
  countries.some((country) => country.iso3 === activeCountry.value)
    ? activeCountry.value
    : (countries[0]?.iso3 ?? DEFAULT_COUNTRY),
);

function ProgressBar({ total, index }: { total: number; index: number }) {
  return (
    <div
      class="mb-8 grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${total},minmax(0,1fr))` }}
      role="progressbar"
      aria-label="Quiz progress"
      aria-valuenow={index + 1}
      aria-valuemin={1}
      aria-valuemax={total}
    >
      {Array.from({ length: total }, (_, i) => (
        <div class={`h-1.5 rounded-full ${i === index ? "bg-accent-ink" : i < index ? "bg-ink" : "bg-ink/15"}`} />
      ))}
    </div>
  );
}

export default function Quiz() {
  const quiz = quizSignal.value;
  const heading = useRef<HTMLHeadingElement>(null);
  const stepKey = `${countryChosen.value}:${currentIndex.value}`;
  const shownStep = useRef(stepKey);

  // Each step replaces the previous one in place, so move focus to announce it.
  useEffect(() => {
    if (shownStep.current !== stepKey) heading.current?.focus();
    shownStep.current = stepKey;
  }, [stepKey]);

  if (!countryChosen.value) {
    return (
      <div class="mx-auto max-w-7xl px-6 py-4">
        <ProgressBar total={(quiz?.steps.length ?? 0) + 1} index={0} />
        <CountryStep headingRef={heading} />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div class="mx-auto max-w-5xl px-6 py-20 text-center" role={quizError.value ? "alert" : "status"}>
        <h1 class="font-serif text-3xl text-ink">
          {quizError.value ? "We couldn’t load that country." : "Loading the country model…"}
        </h1>
        {quizError.value && (
          <Button variant="outline" type="button" onClick={editCountry} class="mt-6">
            Choose another country
          </Button>
        )}
      </div>
    );
  }

  const steps = quiz.steps;
  const total = steps.length;
  const questionById = (id: string) => quiz.questions.find((question) => question.id === id);
  const index = currentIndex.value;
  const step = steps[index];
  if (!step) return null;
  const crowd = crowdRemaining(answers.value);
  const canContinue =
    step.questionIds.every((id) => {
      const question = questionById(id);
      return question && isAnswered(question, answers.value[id]);
    }) &&
    (step.kind !== "dob" || isValidDob(answers.value));
  const answered = steps
    .slice(0, index)
    .flatMap((earlier) => earlier.questionIds.map(questionById))
    .filter((question) => question != null)
    .filter((question) => isAnswered(question, answers.value[question.id]));

  const next = () => {
    if (index === total - 1) {
      submitAnswers();
      location.assign(`/result?country=${quiz.iso3}`);
      return;
    }
    currentIndex.value = index + 1;
  };
  const prev = () => {
    if (index === 0) {
      editCountry();
      return;
    }
    currentIndex.value = index - 1;
  };

  return (
    <div class="mx-auto max-w-7xl px-6 py-4">
      {/* The country step comes before the questions, hence one extra. */}
      <ProgressBar total={total + 1} index={index + 1} />

      <div class="grid grid-cols-1 gap-12 md:grid-cols-2">
        <section>
          <p class="text-ink/70 text-xs uppercase tracking-wide">{quiz.countryName}</p>
          <div class="mt-2" role="status">
            <p class="font-medium font-serif text-5xl text-ink leading-none sm:text-7xl">{fmt(crowd)}</p>
            <p class="text-ink text-xl">people who could be you</p>
          </div>

          <div class="mt-6 overflow-hidden">
            <DotField variant="black" crowd={crowd} />
          </div>

          <div class="mt-5 flex flex-wrap gap-2">
            {answered.map((question) => {
              const { label } = answerDisplay(quiz, question, answers.value);
              return (
                <span key={question.id} class="rounded-md bg-ink/5 px-3 py-1.5 text-ink text-xs">
                  <span class="text-ink/70">{question.attr} </span>
                  <strong class="font-semibold">{label}</strong>
                </span>
              );
            })}
          </div>
        </section>

        <section>
          <p class="text-ink/70 text-sm">
            Question {index + 1} of {total}
          </p>
          <h1 ref={heading} tabIndex={-1} class="mt-2 font-semibold text-4xl text-ink">
            {step.title}
          </h1>
          {step.blurb && <p class="mt-4 max-w-md text-ink/75 text-sm">{step.blurb}</p>}

          {step.kind === "dob" ? <DobInputs /> : <SingleSelect stepId={step.id} />}

          <div class="mt-8 flex items-center justify-between">
            <Button variant="text" type="button" onClick={prev}>
              {index === 0 ? "← Change country" : "← Previous"}
            </Button>
            <Button type="button" onClick={next} disabled={!canContinue}>
              {index === total - 1 ? "See result" : "Continue"} →
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function CountryStep({ headingRef }: { headingRef: Ref<HTMLHeadingElement> }) {
  const start = () => {
    if (pickedCountry.value) chooseCountry(pickedCountry.value);
  };
  return (
    <div class="grid grid-cols-1 gap-12 md:grid-cols-2">
      <section>
        <p class="text-ink/70 text-xs uppercase tracking-wide">Step 1</p>
        <h1 ref={headingRef} tabIndex={-1} class="mt-2 font-semibold text-4xl text-ink">
          Which country are you in?
        </h1>
        <p class="mt-4 max-w-md text-ink/75 text-sm">
          We compare you against that country’s census. Pick where you live, and we’ll ask a handful of everyday details
          about you.
        </p>
      </section>

      <section>
        <label for="country" class="text-ink/70 text-sm">
          Country of residence
        </label>
        <select
          id="country"
          autocomplete="country-name"
          class="mt-2 block w-full border border-ink bg-transparent px-4 py-3 font-semibold text-base text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          value={pickedCountry.value}
          onChange={(e) => {
            pickedCountry.value = (e.target as HTMLSelectElement).value;
          }}
        >
          {countries.map((country) => (
            <option key={country.iso3} value={country.iso3}>
              {country.name}
            </option>
          ))}
        </select>
        <p class="mt-2 text-ink/70 text-xs">
          {countries.length} {countries.length === 1 ? "country" : "countries"} available.
        </p>

        <div class="mt-8 flex justify-end">
          <Button type="button" onClick={start}>
            Continue →
          </Button>
        </div>
      </section>
    </div>
  );
}

function SingleSelect({ stepId }: { stepId: string }) {
  const question = quizSignal.value?.questions.find((candidate) => candidate.id === stepId);
  if (!question) return null;
  const selected = answers.value[question.id];
  return (
    <fieldset class="mt-6 grid gap-2 sm:grid-cols-2">
      <legend class="sr-only">{question.title}</legend>
      {question.options.map((option) => (
        <label
          key={option.id}
          class={`flex items-center justify-between border px-4 py-3 text-sm transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink has-[:focus-visible]:outline-offset-2 ${
            option.id === selected ? "border-accent-ink bg-accent/30 text-navy" : "border-ink text-navy hover:bg-ink/20"
          }`}
        >
          <input
            type="radio"
            name={question.id}
            class="sr-only"
            checked={option.id === selected}
            onChange={() => setAnswer(question.id, option.id)}
          />
          <span class="font-semibold">{option.label}</span>
          <span class="text-xs opacity-80">{option.crowdLabel}</span>
        </label>
      ))}
    </fieldset>
  );
}

function DobInputs() {
  const inputClass =
    "block border border-ink bg-transparent px-3 py-2 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2";
  const fields = [
    { id: "dob_day", label: "Day", autocomplete: "bday-day", maxLength: 2, width: "w-16" },
    { id: "dob_month", label: "Month", autocomplete: "bday-month", maxLength: 2, width: "w-16" },
    { id: "dob_year", label: "Year", autocomplete: "bday-year", maxLength: 4, width: "w-24" },
  ] as const;
  const complete = answers.value.dob_day && answers.value.dob_month && answers.value.dob_year?.length === 4;
  const invalid = !!complete && !isValidDob(answers.value);

  return (
    <fieldset class="mt-6">
      <legend class="sr-only">Date of birth</legend>
      <div class="flex items-end gap-4">
        {fields.map(({ id, label, autocomplete, maxLength, width }) => (
          <div key={id}>
            <label for={id} class="mb-2 block text-ink text-sm">
              {label}
            </label>
            <input
              id={id}
              type="text"
              inputmode="numeric"
              autocomplete={autocomplete}
              pattern="[0-9]*"
              maxlength={maxLength}
              aria-invalid={invalid}
              aria-describedby={invalid ? "dob-error" : undefined}
              class={`${inputClass} ${width} text-center`}
              value={answers.value[id] ?? ""}
              onInput={(event) => setAnswer(id, onlyDigits((event.target as HTMLInputElement).value, maxLength))}
            />
          </div>
        ))}
      </div>
      {invalid && (
        <p id="dob-error" role="alert" class="mt-3 text-ink text-sm">
          That date doesn’t exist. Use a real day and month, and a year between 1900 and today.
        </p>
      )}
    </fieldset>
  );
}
