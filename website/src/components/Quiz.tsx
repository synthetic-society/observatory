import { signal } from "@preact/signals";
import type { Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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
  goToStep,
  quizError,
  quiz as quizSignal,
  setAnswer,
} from "../lib/store";
import DotField from "./DotField";
import Button from "./ui/Button";

const CROWD_SETTLE_MS = 200;
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
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a segment is nothing but its position
          key={i}
          class={`h-1.5 rounded-full ${i === index ? "bg-accent-ink" : i < index ? "bg-ink" : "bg-ink/15"}`}
        />
      ))}
    </div>
  );
}

// Redrawing the dot field on every keystroke is wasted work, so let the crowd settle first.
function CrowdField({ crowd }: { crowd: number }) {
  const [settled, setSettled] = useState(crowd);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(crowd), CROWD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [crowd]);
  return <DotField variant="black" crowd={settled} />;
}

export default function Quiz() {
  const quiz = quizSignal.value;
  const heading = useRef<HTMLHeadingElement>(null);
  const [blocked, setBlocked] = useState(false);
  const stepKey = `${countryChosen.value}:${currentIndex.value}`;
  const shownStep = useRef(stepKey);

  useEffect(() => {
    if (shownStep.current !== stepKey) {
      heading.current?.focus();
      setBlocked(false);
    }
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
    if (!canContinue) {
      setBlocked(true);
      return;
    }
    if (index === total - 1) {
      location.assign(`/result?country=${quiz.iso3}`);
      return;
    }
    goToStep(index + 1);
  };
  const prev = () => (index === 0 ? editCountry() : goToStep(index - 1));

  return (
    <div class="mx-auto max-w-7xl px-6 py-4">
      {/* The country step comes before the questions, hence one extra */}
      <ProgressBar total={total + 1} index={index + 1} />

      <div class="grid grid-cols-1 gap-12 md:grid-cols-2">
        <section class="md:order-2">
          <p class="text-ink/70 text-sm">
            Question {index + 1} of {total}
          </p>
          <h1 ref={heading} tabIndex={-1} class="mt-2 font-semibold text-4xl text-ink">
            {step.title}
          </h1>
          {step.blurb && <p class="mt-4 max-w-md text-ink/75 text-sm">{step.blurb}</p>}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
          >
            {step.kind === "dob" ? <DobInputs blocked={blocked} /> : <SingleSelect stepId={step.id} />}

            {blocked && !canContinue && step.kind !== "dob" && (
              <p role="alert" class="mt-3 font-semibold text-ink text-sm">
                Choose an answer to continue.
              </p>
            )}

            <div class="mt-8 flex items-center justify-between">
              <Button variant="text" type="button" onClick={prev}>
                {index === 0 ? "← Change country" : "← Previous"}
              </Button>
              <Button type="submit">{index === total - 1 ? "See result" : "Continue"} →</Button>
            </div>
          </form>
        </section>

        <section class="md:order-1">
          <p class="text-ink/70 text-xs uppercase tracking-wide">{quiz.countryName}</p>
          <div class="mt-2" role="status">
            <p class="font-medium font-serif text-5xl text-ink leading-none sm:text-7xl">{fmt(crowd)}</p>
            <p class="text-ink text-xl">people who could be you</p>
          </div>

          <div class="mt-6 overflow-hidden">
            <CrowdField crowd={crowd} />
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <label for="country" class="text-ink/70 text-sm">
          Country of residence
        </label>
        {/* We use appearance-none to prevent WebKit from painting its own opaque control background */}
        <div class="relative mt-2">
          <select
            id="country"
            autocomplete="country-name"
            class="block w-full appearance-none border border-ink bg-transparent py-3 pr-11 pl-4 font-semibold text-base text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
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
          <svg
            class="pointer-events-none absolute inset-y-0 right-4 my-auto h-4 w-4 text-ink"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <p class="mt-2 text-ink/70 text-xs">
          {countries.length} {countries.length === 1 ? "country" : "countries"} available.
        </p>

        <div class="mt-8 flex justify-end">
          <Button type="submit">Continue →</Button>
        </div>
      </form>
    </div>
  );
}

function SingleSelect({ stepId }: { stepId: string }) {
  const question = quizSignal.value?.questions.find((candidate) => candidate.id === stepId);
  if (!question) return null;
  const selected = answers.value[question.id];
  return (
    <fieldset class="mt-6 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2">
      <legend class="sr-only">{question.title}</legend>
      {question.options.map((option) => (
        <label
          key={option.id}
          class={`flex items-center justify-between border px-4 py-3 text-sm transition has-focus-visible:outline-2 has-focus-visible:outline-ink has-focus-visible:outline-offset-2 ${
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

function DobInputs({ blocked }: { blocked: boolean }) {
  const inputClass =
    // We use 16px text to prevent iOS Safari from zooming in when focusing on a field
    "block border border-ink bg-transparent px-3 py-2.5 text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2";
  const fields = [
    { id: "dob_day", label: "Day", autocomplete: "bday-day", maxLength: 2, width: "w-16" },
    { id: "dob_month", label: "Month", autocomplete: "bday-month", maxLength: 2, width: "w-16" },
    { id: "dob_year", label: "Year", autocomplete: "bday-year", maxLength: 4, width: "w-24" },
  ] as const;
  const complete = answers.value.dob_day && answers.value.dob_month && answers.value.dob_year?.length === 4;
  const invalid = (!!complete || blocked) && !isValidDob(answers.value);

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
        <p id="dob-error" role="alert" class="mt-3 font-semibold text-ink text-sm">
          Enter a real date of birth: a day, a month, and a year between 1900 and today.
        </p>
      )}
    </fieldset>
  );
}
