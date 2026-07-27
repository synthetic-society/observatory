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
  primary: "border-accent border-b-2 bg-accent-ink font-semibold text-white shadow-sm hover:brightness-110",
  outline: "rounded-md border border-ink font-semibold text-ink hover:bg-ink hover:text-white",
  text: "text-ink hover:underline underline-offset-4",
};

export const buttonClasses = ({ variant = "primary", size = "md" }: StyleProps = {}, extra = "") =>
  `inline-flex items-center justify-center gap-2 transition focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;

export default function Button({ variant, size, class: extra, ...props }: Props) {
  return <button class={buttonClasses({ variant, size }, extra)} {...props} />;
}
