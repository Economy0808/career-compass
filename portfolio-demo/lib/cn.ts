/** Join class names, dropping falsy entries. Replaces clsx (no new deps). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
