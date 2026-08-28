"use client";

/*
 * "/" = 항상 망원경 랜딩 (사용자 지시: "로컬호스트 진입시 랜딩페이지가 아니라
 * 소셜창이 뜸. 이거먼저 해결해" - 로그인 여부와 무관하게 진입은 랜딩이다).
 * 소셜 피드는 좌측 네비 "소셜"의 목적지인 /feed 에만 산다.
 * 랜딩 우상단 링크는 로그인 상태를 알아서 갈아탄다(TelescopeLanding 내부).
 */

import { TelescopeLanding } from "@/components/TelescopeLanding";

export default function HomePage() {
  return <TelescopeLanding />;
}
