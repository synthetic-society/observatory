import type { JSX } from "preact";

type Variant = "primary" | "outline" | "text";
type Size = "md" | "lg";

type StyleProps = {
  variant?: Variant;
  size?: Size;
};

type Props = Omit<JSX.IntrinsicElements["button"], "size" | "ref"> & StyleProps;

const SIZES: Record<Size, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-5 py-3 text-sm",
};

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-b-2 border-accent bg-accent/80 font-semibold text-white shadow-sm hover:border-accent/60 hover:bg-accent/60",
  outline: "rounded-md border border-ink font-semibold text-ink hover:bg-ink hover:text-white",
  text: "text-ink hover:underline underline-offset-4",
};

export const buttonClasses = ({ variant = "primary", size = "md" }: StyleProps = {}, extra = "") =>
  `inline-flex items-center justify-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;

export default function Button({ variant, size, class: extra, ...props }: Props) {
  return <button class={buttonClasses({ variant, size }, extra)} {...props} />;
}
