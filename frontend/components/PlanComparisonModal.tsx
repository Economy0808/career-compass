"use client";

/**
 * 요금제 비교 모달 - 우주 밝기 순 등급(Spark -> Nova -> Supernova -> Quasar)을
 * 카드로 나란히 보여준다. 관측 표면(다크 ink)에 뜨는 창이라 대화 캔버스와 같은
 * 세계다.
 *
 * 결제 모듈(토스페이먼츠) 대비 구조(사용자 지시 "결제모듈 달거 생각하고 디자인"):
 * - 가격·크레딧은 lib/plans.ts 단일 상수에서만 온다(하드코딩 없음).
 * - 유료 티어의 구매 CTA는 onPurchase(tierId) 훅을 미리 둔다. 지금(S0)은 부모가
 *   이 prop을 안 넘겨 버튼이 "준비 중" 비활성이고, S2에서 그 자리가 토스
 *   결제위젯을 띄운다 - 그때 부모가 onPurchase만 넣으면 이 컴포넌트는 무변경.
 */

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "@/components/ui/icons";
import { PLAN_TIERS, pricePerCycle, type PlanTier } from "@/lib/plans";

export interface PlanComparisonModalProps {
  open: boolean;
  onClose: () => void;
  /** 결제 모듈 훅. 넘기면 유료 티어 버튼이 활성("구매하기")되고 누르면 이 콜백에
   * tierId가 전달된다. 안 넘기면(현 S0) 버튼은 "준비 중" 비활성. */
  onPurchase?: (tierId: string) => void;
  /** 현재 무료권 잔량(0|1). 표시용 - 있으면 Spark 카드에 "남은 무료권"을 띄운다. */
  freeCreditLeft?: number;
  /** 현재 크레딧 잔량. 표시용. */
  credits?: number;
}

// 티어별 악센트 - 우주 밝기 순(무료=흐린 별 -> Quasar=가장 밝은). 새 색이 아니라
// globals.css의 분광형/별빛 토큰을 밝기 순으로 매핑한 것.
const TIER_ACCENT: Record<string, string> = {
  spark: "var(--text-lo)",
  nova: "var(--spec-b)",
  supernova: "var(--spec-a)",
  quasar: "var(--lit)",
};

export function PlanComparisonModal({
  open,
  onClose,
  onPurchase,
  freeCreditLeft,
  credits,
}: PlanComparisonModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="요금제"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink-900/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-rule bg-ink-800 p-6 shadow-lg"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <h2 className="font-serif text-title font-bold text-text-hi">요금제</h2>
            <p className="mt-1 font-sans text-body-sm text-text-lo">
              별자리 1개 = 대화부터 완성까지 한 사이클. 크레딧은 무기한이에요.
            </p>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_TIERS.map((tier) => (
            <PlanCard
              key={tier.id}
              tier={tier}
              onPurchase={onPurchase}
              freeCreditLeft={freeCreditLeft}
              credits={credits}
            />
          ))}
        </div>

        <p className="mt-4 font-sans text-micro text-text-lo">
          {/* S0 결제 미구현 안내 - 실결제(토스페이먼츠)는 준비 중. */}
          결제 기능은 준비 중이에요. 지금은 가입 시 드리는 무료 1개로 체험할 수 있어요.
        </p>
      </div>
    </div>
  );
}

function PlanCard({
  tier,
  onPurchase,
  freeCreditLeft,
  credits,
}: {
  tier: PlanTier;
  onPurchase?: (tierId: string) => void;
  freeCreditLeft?: number;
  credits?: number;
}) {
  const accent = TIER_ACCENT[tier.id] ?? "var(--text-lo)";
  const perCycle = pricePerCycle(tier);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border bg-ink-900/40 p-4",
        tier.recommended ? "border-spec-a" : "border-rule"
      )}
    >
      {tier.recommended && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-spec-a px-2.5 py-0.5 font-sans text-micro font-bold text-ink-900">
          추천
        </span>
      )}

      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
        <h3 className="font-serif text-heading font-bold text-text-hi">{tier.name}</h3>
      </div>

      <div>
        <div className="font-mono text-title font-bold tabular-nums text-text-hi">
          {tier.free ? "무료" : `${tier.price.toLocaleString("ko-KR")}원`}
        </div>
        <div className="mt-0.5 font-sans text-caption text-text-lo">
          {tier.free ? "가입 시 1개" : `별자리 ${tier.cycles}개`}
          {perCycle !== null && <span className="text-text-lo"> · 개당 {perCycle.toLocaleString("ko-KR")}원</span>}
        </div>
      </div>

      <p className="min-h-[2.6em] font-sans text-body-sm leading-snug text-text-lo">{tier.blurb}</p>

      {tier.free ? (
        <div className="mt-auto rounded-md border border-rule bg-ink-800 px-3 py-2 text-center font-sans text-caption text-text-lo">
          {typeof freeCreditLeft === "number"
            ? freeCreditLeft > 0
              ? "남은 무료권 1개"
              : "무료권 다 썼어요"
            : "기본 제공"}
        </div>
      ) : (
        <button
          type="button"
          disabled={!onPurchase}
          onClick={onPurchase ? () => onPurchase(tier.id) : undefined}
          className={cn(
            "mt-auto rounded-md px-3 py-2 font-sans text-body-sm font-semibold transition-[filter]",
            onPurchase
              ? "cta-ink bg-spec-b text-ink-900 hover:brightness-110"
              : "cursor-not-allowed border border-rule bg-ink-800 text-text-lo",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          )}
        >
          {onPurchase ? "구매하기" : "준비 중"}
        </button>
      )}

      {!tier.free && typeof credits === "number" && credits > 0 && (
        <p className="text-center font-sans text-micro text-text-lo">보유 크레딧 {credits}개</p>
      )}
    </div>
  );
}
