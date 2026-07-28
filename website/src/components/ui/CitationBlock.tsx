import { useEffect, useRef, useState } from "preact/hooks";
import { buttonClasses } from "./Button";

type Props = { bibtex: string; citations: Record<string, string> };

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-2 font-semibold text-ink text-sm transition hover:bg-ink hover:text-white focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2";

export default function CitationBlock({ bibtex, citations }: Props) {
  const [style, setStyle] = useState(Object.keys(citations)[0]);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && picker.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event instanceof KeyboardEvent) toggle.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const copy = async (label: string, text: string) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setFailed(false);
      timer.current = setTimeout(() => setCopied(null), 3000);
    } catch {
      setCopied(null);
      setFailed(true);
    }
  };

  const pick = (name: string) => {
    setStyle(name);
    setOpen(false);
    toggle.current?.focus();
    return copy(name, citations[name]);
  };

  return (
    <div>
      <p class="text-ink text-sm leading-relaxed">{citations[style]}</p>
      <div class="mt-6 flex flex-wrap items-start gap-3">
        <button type="button" class={buttonClasses({ variant: "outline" })} onClick={() => copy("BibTeX", bibtex)}>
          {copied === "BibTeX" ? "BibTeX copied" : "Copy BibTeX"}
        </button>
        <div ref={picker} class="relative inline-flex rounded-md border border-ink">
          <button type="button" class={`${SEGMENT} rounded-l-md px-5`} onClick={() => copy(style, citations[style])}>
            {copied === style ? "Citation copied" : `Copy citation as ${style}`}
          </button>
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-label="Copy in another citation style"
            class={`${SEGMENT} rounded-r-md border-ink border-l px-3`}
            onClick={() => setOpen(!open)}
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {/* The menu opens upwards because the footer ends the page. */}
          {open && (
            <ul class="absolute right-0 bottom-full z-10 mb-2 min-w-full border border-ink bg-bg shadow-sm">
              {Object.keys(citations).map((name) => (
                <li key={name} class="border-ink/15 border-t first:border-t-0">
                  <button
                    type="button"
                    class={`flex min-h-11 w-full items-center whitespace-nowrap px-4 text-ink text-sm transition hover:bg-ink hover:text-white ${name === style ? "font-semibold" : ""}`}
                    onClick={() => pick(name)}
                  >
                    Copy as {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p aria-live="polite" class="sr-only">
        {copied ? `${copied} citation copied to clipboard` : ""}
      </p>
      {failed && (
        <p class="mt-3 text-ink text-sm">Copying failed, please select the citation above and copy it manually.</p>
      )}
    </div>
  );
}
