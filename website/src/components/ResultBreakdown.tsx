import { useEffect, useRef, useState } from "preact/hooks";
import type { Quiz } from "../data/quiz";
import { answerDisplay, answerIndices, computeShare, shareScales } from "../data/quiz";
import { answers as answersSignal, getQuiz, loadAnswers, quiz as quizSignal, reset } from "../lib/store";
import { createUniquenessClient, type UniquenessClient } from "../workers/uniquenessClient";
import Button from "./ui/Button";

const DRAWS = 30;
const SEED = 42;
const LOADING_MESSAGE_DELAY = 600; // Small debounce to avoid a flash of text if the model loads quickly
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (value: number) => {
  if (value >= 0.1) return (value * 100).toFixed(1);
  if (value >= 0.0001) return (value * 100).toFixed(2);
  return value > 0 ? "<0.01" : "0";
};

const computeFor = (
  client: UniquenessClient,
  quiz: Quiz,
  answers: Record<string, string>,
  enabled: Record<string, boolean>,
) => client.compute(answerIndices(quiz, answers, enabled), shareScales(quiz, answers, enabled), DRAWS, SEED);

export default function ResultBreakdown() {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [baseline, setBaseline] = useState(0);
  const [current, setCurrent] = useState(0);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const client = useRef<UniquenessClient | null>(null);
  const latestToggle = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // The result replaces the loading message, so move focus to announce it.
  useEffect(() => {
    if (phase === "ready") heading.current?.focus();
  }, [phase]);

  useEffect(() => {
    const timer = setTimeout(() => setShowLoading(true), LOADING_MESSAGE_DELAY);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const storedAnswers = loadAnswers();
    if (!Object.keys(storedAnswers).length) {
      location.replace("/quiz");
      return;
    }

    answersSignal.value = storedAnswers;
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

  if (phase === "loading" && !showLoading) return null;

  const quiz = quizSignal.value;
  if (!quiz) {
    return (
      <div class="mx-auto max-w-5xl px-6 py-20 text-center" role={phase === "error" ? "alert" : "status"}>
        <h1 class="font-serif text-3xl text-ink">
          {phase === "error" ? "We couldn’t calculate your result." : "Loading the country model…"}
        </h1>
        {phase === "error" && (
          <Button variant="outline" type="button" onClick={() => location.assign("/quiz")} class="mt-6">
            Retake the quiz
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
      <div class="mx-auto max-w-5xl px-6 py-20 text-center" role={phase === "error" ? "alert" : "status"}>
        <h1 class="text-3xl text-ink/50">
          {phase === "error" ? "We couldn’t calculate your result." : "Computing your identifiability…"}
        </h1>
        <p class="mt-3 text-ink/70 text-sm">
          {phase === "error"
            ? "Please retake the quiz and try again."
            : `Loading the ${quiz.countryName} copula model.`}
        </p>
        {phase === "error" && (
          <Button variant="outline" type="button" onClick={retake} class="mt-6">
            Retake the quiz
          </Button>
        )}
      </div>
    );
  }

  const toggle = (questionId: string) => {
    const worker = client.current;
    if (!worker) return;
    const previous = enabled;
    const next = { ...enabled, [questionId]: !enabled[questionId] };
    const token = ++latestToggle.current;
    setEnabled(next);
    setRecomputing(true);
    computeFor(worker, quiz, answersSignal.value, next)
      .then((value) => {
        if (token !== latestToggle.current) return;
        setCurrent(value);
        setRecomputing(false);
        setToggleFailed(false);
      })
      .catch(() => {
        if (token !== latestToggle.current || !client.current) return;
        setEnabled(previous);
        setRecomputing(false);
        setToggleFailed(true);
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
    const share = computeShare(quiz, question, answers);
    if (on) shareSoFar *= share;
    const remaining = Math.max(1, Math.round(quiz.population * shareSoFar));
    const oneIn = shareSoFar > 0 ? Math.max(1, Math.round(1 / shareSoFar)) : quiz.population;
    return {
      questionId: question.id,
      label: quiz.resultLabels[question.id] ?? question.attr,
      value,
      remaining,
      oneIn,
      // How much this one answer narrows the crowd, on a log scale so rare and common answers stay comparable.
      selectivity: share > 0 && share < 1 ? Math.log(1 / share) : 0,
      on,
    };
  });
  const maxSelectivity = Math.max(1e-9, ...rows.map((row) => row.selectivity));

  const popLabel =
    quiz.population >= 1e6
      ? `${(quiz.population / 1e6).toFixed(1)} million`
      : quiz.population >= 1e3
        ? `${(quiz.population / 1e3).toFixed(0)},000`
        : `${quiz.population}`;

  return (
    <div class="mx-auto max-w-7xl px-6 py-12">
      <div>
        <h1 ref={heading} tabIndex={-1} class="text-balance font-semibold text-4xl text-ink leading-[1.05] sm:text-6xl">
          You are <span class="font-medium font-serif text-accent-ink italic">{basePct}%</span> identifiable from the
          answers you gave.
        </h1>
        <p class="my-6 max-w-3xl text-balance text-ink/75 text-xl">
          Among {popLabel} people in {quiz.countryName}, our statistical model fitted on census data picks you out from{" "}
          {total} everyday {total === 1 ? "answer" : "answers"}.
        </p>
        <Button variant="outline" type="button" onClick={retake}>
          Retake the quiz
        </Button>
      </div>

      <div class="mt-20">
        <div class="mb-8 flex flex-col gap-3 md:flex-row md:items-baseline md:justify-between">
          <h2 class="font-semibold text-2xl text-ink">What made you findable</h2>
          <div>
            <p class="text-ink/75 text-lg" role="status" aria-busy={recomputing}>
              {someOff ? (
                <>
                  With only {onCount} {onCount === 1 ? "attribute" : "attributes"}, you would have been{" "}
                  <span class="font-serif text-accent-ink italic">{currentPct}%</span> identifiable.
                </>
              ) : (
                "Toggle an attribute off to see how much less identifiable you'd be."
              )}
            </p>
            {toggleFailed && (
              <p role="alert" class="mt-1 font-semibold text-ink text-sm">
                That change didn’t go through. Try toggling it again.
              </p>
            )}
          </div>
        </div>

        <ul class="divide-y divide-ink/10 border-ink/10 border-y">
          {rows.map((row) => {
            const barWidth = (row.selectivity / maxSelectivity) * 100;
            return (
              <li
                key={row.questionId}
                class={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 lg:grid-cols-[24px_140px_200px_1fr_140px_200px] lg:gap-y-0 lg:py-2.5 ${
                  row.on ? "text-ink" : "text-ink/70"
                }`}
              >
                <input
                  id={`include-${row.questionId}`}
                  type="checkbox"
                  checked={row.on}
                  onChange={() => toggle(row.questionId)}
                  class="col-start-1 row-start-1 h-6 w-6 cursor-pointer accent-ink lg:col-start-auto lg:row-start-auto"
                />
                <label
                  for={`include-${row.questionId}`}
                  class="col-start-2 row-start-1 -my-2 cursor-pointer py-2 font-semibold lg:col-start-auto lg:row-start-auto"
                >
                  {row.label}
                </label>
                <span class="col-start-2 row-start-2 truncate text-ink/70 text-sm lg:col-start-auto lg:row-start-auto lg:text-base">
                  {row.value}
                </span>
                <div
                  class="col-span-2 col-start-2 row-start-3 mt-1 flex items-center gap-3 lg:col-span-1 lg:col-start-auto lg:row-start-auto lg:mt-0"
                  aria-hidden="true"
                >
                  <div class="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <div
                      class={`h-full rounded-full ${row.on ? "bg-accent-ink" : "bg-ink/25"}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
                <span class="col-start-3 row-start-1 text-right text-ink/70 tabular-nums lg:col-start-auto lg:row-start-auto">
                  {row.on && `${row.remaining < 10 ? "±" : ""}${fmt(row.remaining)} left`}
                </span>
                <span class="col-start-3 row-start-2 text-right text-sm tabular-nums lg:col-start-auto lg:row-start-auto lg:text-base">
                  {row.on && `1 in ${fmt(row.oneIn)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
