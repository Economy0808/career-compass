/**
 * 요금제·무료 한도 단일 진실 공급원 (2026-09-03 사용자 확정).
 *
 * 가격·크레딧·티어명은 전부 여기서만 정의한다 — 화면 곳곳에 하드코딩하지 않는다.
 * 결제 모듈(토스페이먼츠) 도입을 염두에 둔 구조: 지금(S0)은 이 상수가 정본이고,
 * 나중에 백엔드가 GET /plans로 같은 값을 내려줘도 이 파일과 일치해야 한다.
 * 구매 버튼은 S0에서 비활성(onPurchase no-op)이고, S2에서 그 자리가 토스
 * 결제위젯을 띄운다.
 *
 * 단위: "별자리 1개 = 1사이클"(대화 + 초안 생성). 무료는 가입 시 1개 지급하고
 * 리셋하지 않는다(별자리는 진로 로드맵이라 일회성 — 매일 리셋은 리텐션이
 * 쌓일수록 원가가 폭증한다). 소진하면 유료 팩(크레딧 무기한)을 산다.
 * 차감 시점은 대화 첫 메시지(사용자 확정) — 백엔드가 첫 /chat에서 1회 차감한다.
 */

export interface PlanTier {
  /** 서버·URL에서 쓰는 안정적 식별자. */
  id: string;
  /** 화면 표기명(우주 밝기 순 등급). */
  name: string;
  /** 원. 무료 티어는 0. */
  price: number;
  /**
   * 이 티어가 주는 사이클 수. 무료(Spark)는 가입 시 1회성 지급이고,
   * 유료 팩은 구매 시 크레딧으로 적립(무기한).
   */
  cycles: number;
  /** 무료 티어 여부 — 구매 CTA 대신 "기본 제공"으로 표시한다. */
  free?: boolean;
  /** 추천 강조 티어(플랜 비교에서 하이라이트). */
  recommended?: boolean;
  /** 한 줄 소개(플랜 카드 부제). */
  blurb: string;
}

/** 우주 밝기 순 등급: Spark -> Nova -> Supernova -> Quasar. */
export const PLAN_TIERS: PlanTier[] = [
  {
    id: "spark",
    name: "Spark",
    price: 0,
    cycles: 1,
    free: true,
    blurb: "가입하면 별자리 1개를 무료로. 먼저 만들어 보세요.",
  },
  {
    id: "nova",
    name: "Nova",
    price: 4900,
    cycles: 5,
    blurb: "진로를 여러 갈래로 그려 볼 다섯 번.",
  },
  {
    id: "supernova",
    name: "Supernova",
    price: 14900,
    cycles: 18,
    recommended: true,
    blurb: "졸업까지 계획을 충분히 다듬을 열여덟 번.",
  },
  {
    id: "quasar",
    name: "Quasar",
    price: 19900,
    cycles: 27,
    blurb: "가장 넉넉하게. 회당 가장 저렴합니다.",
  },
];

/** 가입 시 지급하는 무료 사이클 수 — quota 응답의 freeLimit과 일치해야 한다. */
export const FREE_GRANT = 1;

export function planById(id: string): PlanTier | undefined {
  return PLAN_TIERS.find((t) => t.id === id);
}

/** 유료 팩의 회당 단가(원, 반올림). 무료·0회 티어는 null. */
export function pricePerCycle(tier: PlanTier): number | null {
  if (tier.free || tier.cycles === 0) return null;
  return Math.round(tier.price / tier.cycles);
}
