import type { ReactNode } from "react";

/**
 * Cancel the shell's padded container: the beanstalk canvas paints edge to edge
 * and scrolls inside itself, so the shell must not add page-level padding
 * (which would stack a second scrollbar on top of the canvas scroller).
 */
export default function CanvasLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-6 mb-[calc(-1*(var(--tabbar-h)+var(--safe-bottom)+16px))] md:-mx-8 md:-mb-10 md:-mt-10">
      {children}
    </div>
  );
}
