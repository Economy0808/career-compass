"use client";

/*
 * impeccable direction contract — 로그인 사용자 홈: 별자리 소셜 피드
 * MODE: Inform/Explore. 로그인 사용자가 다른 학생들이 발행한 별자리를 둘러보는 관측 기록 열람.
 * AUDIENCE/JOB: 연세대 재학 인증을 마친 학생. 행동 = 카드를 훑어보며 남의 로드맵에서 아이디어를
 *   얻는 것 - 아직 상세 페이지가 없으므로 클릭 유도는 하지 않는다(카드는 정보 표면일 뿐).
 * DIRECTION: TelescopeLanding의 "관측/성도" 어휘를 어두운 우주 쪽으로 그대로 옮긴다. 하나의
 *   관측 로그 헤더(serif 헤드라인 + mono 필드노트 서브라인) 아래 카드 그리드 - 히어로 없음,
 *   피드 자체가 콘텐츠.
 * MEMORABLE MOMENT: 카드 안의 MiniConstellation - 진짜 그래프 데이터를 그대로 축소해 보여주는
 *   것 자체가 장식이다(따로 일러스트를 그리지 않음).
 * CONSTRAINTS: 색은 ink-*, spec-*, text-*, rule 토큰만. 모션은 카드 호버 트랜지션 1개뿐(상시
 *   애니메이션 금지). 카드는 아직 링크가 아니다(상세 페이지 없음) - cursor-default.
 * RESOLVES: .impeccable/surfaces/frontend-app-page-tsx.md의 Unresolved 노트 - 로그인 사용자의
 *   "/"는 이제 이 별자리 피드다. 비로그인 방문자는 TelescopeLanding을 그대로 본다(미변경).
 *
 * 피드 UI 자체(헤더 + 카드 그리드 + 데이터 fetch)는 components/FeedView.tsx로 옮겨졌다 -
 * 로그인 여부와 무관하게 상시 접근 가능한 "/feed"(좌측 레일 "소셜" 항목의 목적지)와
 * 이 로그인 홈이 동일한 컴포넌트를 공유한다. 여기 남은 건 "비로그인이면 랜딩, 로그인이면
 * 피드"라는 라우팅 분기뿐이다.
 */

import { FeedSkeleton, FeedView } from "@/components/FeedView";
import { TelescopeLanding } from "@/components/TelescopeLanding";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();

  if (!loading && !user) return <TelescopeLanding />;
  if (loading) return <FeedSkeleton />;

  return <FeedView />;
}
