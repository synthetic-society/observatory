import { useEffect, useRef, useState } from "preact/hooks";
import type { Quiz } from "../data/quiz";
import { answerDisplay, answerIndices, computeShare, shareScales } from "../data/quiz";
import { answers as answersSignal, getQuiz, loadAnswers, quiz as quizSignal, reset } from "../lib/store";
import { createUniquenessClient, type UniquenessClient } from "../workers/uniquenessClient";
import Button from "./ui/Button";

const DRAWS = 30;
const SEED = 42;
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (value: number) => (value >= 0.1 ? (value * 100).toFixed(1) : value > 0 ? (value * 100).toFixed(2) : "0");

const computeFor = (
  client: UniquenessClient,
  quiz: Quiz,
  answers: Record<string, string>,
  enabled: Record<string, boolean>,
) => client.compute(answerIndices(quiz, answers, enabled), shareScales(quiz, answers, enabled), DRAWS, SEED);

export default function ResultBreakdown() {
  const [phase, setPhase] = useState<"init" | "loading" | "ready" | "error">("init");
  const [baseline, setBaseline] = useState(0);
  const [current, setCurrent] = useState(0);
  // Uniqueness with one attribute left out, keyed by question id.
  const [uniquenessWithout, setUniquenessWithout] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [recomputing, setRecomputing] = useState(false);
  const client = useRef<UniquenessClient | null>(null);
  const latestToggle = useRef(0);

  useEffect(() => {
    const storedAnswers = loadAnswers();
    if (!Object.keys(storedAnswers).length) {
      location.replace("/quiz");
      return;
    }

    answersSignal.value = storedAnswers;
    setPhase("loading");
    const worker = createUniquenessClient();
    client.current = worker;
    let cancelled = false;

    const run = async () => {
      const loaded = await getQuiz();
      await worker.init(loaded.model, loaded.population);
      const questionIds = loaded.questions.map((question) => question.id);
      const allEnabled = Object.fromEntries(questionIds.map((id) => [id, true]));
      const base = await computeFor(worker, loaded, storedAnswers, allEnabled);
      if (cancelled) return;

      setEnabled(allEnabled);
      setBaseline(base);
      setCurrent(base);
      setPhase("ready");

      const without: Record<string, number> = {};
      for (const id of questionIds) {
        without[id] = await computeFor(worker, loaded, storedAnswers, {
          ...allEnabled,
          [id]: false,
        });
        if (cancelled) return;
        setUniquenessWithout({ ...without });
      }
    };

    run().catch(() => {
      if (!cancelled) setPhase("error");
    });

    return () => {
      cancelled = true;
      client.current = null;
      worker.dispose();
    };
  }, []);

  if (phase === "init") return null;

  const quiz = quizSignal.value;
  if (!quiz) {
    return (
      <div class="mx-auto max-w-5xl px-6 py-20 text-center">
        <p class="font-serif text-3xl text-ink">
          {phase === "error" ? "We couldn’t calculate your result." : "Loading the country model…"}
        </p>
        {phase === "error" && (
          <Button variant="outline" type="button" onClick={() => location.assign("/quiz")} class="mt-6">
            Retake the test
          </Button>
        )}
      </div>
    );
  }
  const retake = () => {
    reset();
    location.assign(`/quiz?country=${quiz.iso3}`);
  };

  if (phase !== "ready") {
    return (
      <div class="mx-auto max-w-5xl px-6 py-20 text-center">
        <p class="font-serif text-3xl text-ink">
          {phase === "error" ? "We couldn’t calculate your result." : "Computing your identifiability…"}
        </p>
        <p class="mt-3 text-ink/70 text-sm">
          {phase === "error"
            ? "Please retake the test and try again."
            : `Loading the ${quiz.countryName} copula model.`}
        </p>
        {phase === "error" && (
          <Button variant="outline" type="button" onClick={retake} class="mt-6">
            Retake the test
          </Button>
        )}
      </div>
    );
  }

  const toggle = (questionId: string) => {
    const worker = client.current;
    if (!worker) return;
    const next = { ...enabled, [questionId]: !enabled[questionId] };
    const token = ++latestToggle.current;
    setEnabled(next);
    setRecomputing(true);
    computeFor(worker, quiz, answersSignal.value, next)
      .then((value) => {
        if (token !== latestToggle.current) return;
        setCurrent(value);
        setRecomputing(false);
      })
      .catch(() => {
        if (token === latestToggle.current && client.current) setPhase("error");
      });
  };

  const basePct = pct(baseline);
  const currentPct = pct(current);
  const total = quiz.questions.length;
  const onCount = quiz.questions.reduce((count, question) => count + Number(enabled[question.id]), 0);
  const someOff = onCount < total;

  const answers = answersSignal.value;
  // Shares multiply the further down the list, so each row shows the crowd left after it.
  let shareSoFar = 1;
  const rows = quiz.questions.map((question) => {
    const { label: value } = answerDisplay(quiz, question, answers);
    const on = enabled[question.id] ?? true;
    if (on) shareSoFar *= computeShare(quiz, question, answers);
    const remaining = Math.max(1, Math.round(quiz.population * shareSoFar));
    const oneIn = shareSoFar > 0 ? Math.max(1, Math.round(1 / shareSoFar)) : quiz.population;
    const without = uniquenessWithout[question.id];
    const contribution = without == null ? null : Math.max(0, (baseline - without) * 100);
    return {
      questionId: question.id,
      label: quiz.resultLabels[question.id] ?? question.attr,
      value,
      remaining,
      oneIn,
      contribution,
      on,
    };
  });
  const maxContribution = Math.max(1e-9, ...rows.map((row) => row.contribution ?? 0));

  const popLabel =
    quiz.population >= 1e6
      ? `${(quiz.population / 1e6).toFixed(1)} million`
      : quiz.population >= 1e3
        ? `${(quiz.population / 1e3).toFixed(0)},000`
        : `${quiz.population}`;

  return (
    <div class="mx-auto max-w-7xl px-6 py-12">
      <div>
        <h1 class="text-balance font-semibold text-4xl text-ink leading-[1.05] sm:text-6xl">
          You are <span class="font-medium font-serif text-accent italic">{basePct}%</span> identifiable from the
          answers you gave.
        </h1>
        <p class="my-6 max-w-3xl text-balance text-ink/75 text-xl">
          Among {popLabel} people in {quiz.countryName}, our statistical model fitted on census data picks you out from{" "}
          {total} everyday {total === 1 ? "answer" : "answers"}.
        </p>
        <Button variant="outline" type="button" onClick={retake}>
          Retake the test
        </Button>
      </div>

      <div class="mt-20">
        <div class="mb-8 flex flex-col gap-3 md:flex-row md:items-baseline md:justify-between">
          <h2 class="font-semibold text-2xl text-ink">What made you findable</h2>
          <p class="text-ink/75 text-lg">
            {someOff ? (
              <>
                With only {onCount} {onCount === 1 ? "attribute" : "attributes"}, you would have been{" "}
                <span
                  class={`font-serif text-accent italic ${recomputing ? "opacity-40" : ""}`}
                  aria-busy={recomputing}
                >
                  {currentPct}%
                </span>{" "}
                identifiable.
              </>
            ) : (
              "Toggle an attribute off to see how much less identifiable you'd be."
            )}
          </p>
        </div>

        <ul class="divide-y divide-ink/10 border-ink/10 border-y">
          {rows.map((row) => {
            const barWidth = row.contribution != null ? (row.contribution / maxContribution) * 100 : 0;
            return (
              <li
                key={row.questionId}
                class={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-4 py-2.5 md:grid-cols-[24px_140px_200px_1fr_140px_200px] ${
                  row.on ? "text-ink" : "text-ink/70"
                }`}
              >
                <input
                  type="checkbox"
                  checked={row.on}
                  onChange={() => toggle(row.questionId)}
                  aria-label={`Include ${row.label}`}
                  class="h-4 w-4 accent-ink"
                />
                <span class="font-semibold">{row.label}</span>
                <span class="hidden truncate text-ink/70 md:inline">{row.value}</span>
                <div class="hidden items-center gap-3 md:flex">
                  <div class="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <div
                      class={`h-full rounded-full ${row.on ? "bg-accent" : "bg-ink/25"}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
                <span class="text-right text-ink/70 tabular-nums">
                  {row.on && `${row.remaining < 10 ? "±" : ""}${fmt(row.remaining)} left`}
                </span>
                <span class="hidden text-right tabular-nums md:inline">{row.on && `1 in ${fmt(row.oneIn)}`}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
