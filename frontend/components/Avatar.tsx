const SIZES = {
  sm: "h-8 w-8 text-base",
  md: "h-10 w-10 text-lg",
  lg: "h-14 w-14 text-2xl",
} as const;

export function Avatar({
  emoji,
  size = "md",
}: {
  emoji: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900 ${SIZES[size]}`}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
