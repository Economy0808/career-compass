import Link from "next/link";
import { UserSwitcher } from "./UserSwitcher";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          🧭 로드맵
        </Link>
        <UserSwitcher />
      </div>
    </header>
  );
}
