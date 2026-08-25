import type { ReactNode } from "react";
import { STATIC_USER_IDS } from "@/lib/mock-data";

/** 정적 export는 빌드 시점에 만들 페이지의 id를 알아야 한다. */
export function generateStaticParams() {
  return STATIC_USER_IDS.map((id) => ({ id }));
}

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
