"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { milestoneSide, milestoneY } from "@/components/BeanstalkCanvas";
import { formatDateKo } from "@/lib/format";
import type { MilestoneStatus, UserOut } from "@/lib/types";

/** 콩나무 상세(로드맵/대목표) 두 페이지가 공유하는 조각들. */

export const CHIP_STYLE: Record<MilestoneStatus, { bg: string; fg: string }> = {
  완료: { bg: "rgba(93,179,91,.2)", fg: "#8fdc8a" },
  진행중: { bg: "rgba(143,206,122,.13)", fg: "#c6ddba" },
  기한초과: { bg: "rgba(196,154,90,.18)", fg: "#d8b078" },
};

/** 첫 진입 시 착지할 스크롤 위치 — 아직 완주하지 않은 가장 아래 가지. */
export function computeLandingScrollTop(
  count: number,
  firstIncompleteIdx: number,
  clientHeight: number,
): number {
  if (firstIncompleteIdx < 0) return 0;
  return Math.max(0, milestoneY(count, firstIncompleteIdx) - clientHeight * 0.52);
}

export function CenteredNotice({
  tone,
  children,
}: {
  tone: "loading" | "error";
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen items-center justify-center">
      <p
        className={
          tone === "loading"
            ? "animate-pulse text-sm text-moss-600"
            : "text-sm text-wither-300"
        }
      >
        {children}
      </p>
    </div>
  );
}

/**
 * 가지 옆 패널의 위치 계산 래퍼. 카드 본문은 페이지마다 크게 다르므로 children으로 받는다.
 * group 클래스는 여기 있어야 로드맵 페이지의 폴라로이드 group-hover가 동작한다.
 */
export function BranchPanel({
  index,
  count,
  status,
  children,
}: {
  index: number;
  count: number;
  status: MilestoneStatus;
  children: ReactNode;
}) {
  const y = milestoneY(count, index);
  const side = milestoneSide(index);
  return (
    <div
      className="group absolute z-[6] w-[292px]"
      style={{
        top: status === "기한초과" ? y - 36 : y - 116,
        left:
          side === 1
            ? "min(calc(50% + 208px), calc(100% - 312px))"
            : "max(16px, calc(50% - 500px))",
      }}
    >
      {children}
    </div>
  );
}

/** 땅 — 심은 사람. */
export function PlanterInfo({
  user,
  createdAt,
  actionLabel,
}: {
  user: UserOut;
  createdAt: string;
  actionLabel: string;
}) {
  return (
    <div className="absolute bottom-[118px] left-1/2 z-[6] flex -translate-x-1/2 flex-col items-center gap-2 text-center">
      <Link
        href={`/profile/${user.id}`}
        className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-[#3f6f49] bg-[rgba(16,36,21,.92)] text-[34px] no-underline shadow-[0_0_34px_rgba(93,179,91,.28)] transition-shadow hover:shadow-[0_0_44px_rgba(93,179,91,.45)]"
      >
        {user.avatar_emoji}
      </Link>
      <div className="text-sm font-bold text-moss-100">{user.display_name}</div>
      <div className="text-[11.5px] text-moss-600">
        {formatDateKo(createdAt)} {actionLabel}
      </div>
    </div>
  );
}

/** 우상단 소유자 칩 + 팔로우 버튼. */
export function OwnerChip({
  user,
  label,
  sub,
  canFollow,
  isFollowing,
  followPending,
  onToggleFollow,
}: {
  user: UserOut;
  label: string;
  sub: string;
  canFollow: boolean;
  isFollowing: boolean | null;
  followPending: boolean;
  onToggleFollow: () => void;
}) {
  return (
    <div className="fixed right-[26px] top-[22px] z-[55] flex items-center gap-2.5 rounded-full border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] py-2 pl-[15px] pr-2.5 backdrop-blur-[10px]">
      <Link href={`/profile/${user.id}`} className="flex items-center gap-2.5 no-underline">
        <span className="text-base">{user.avatar_emoji}</span>
        <span className="text-[13px] font-semibold !text-moss-100 hover:!text-moss-300">
          {label}
        </span>
      </Link>
      <span className="whitespace-nowrap text-[11.5px] text-moss-600">{sub}</span>
      {canFollow && (
        <button
          type="button"
          onClick={onToggleFollow}
          disabled={followPending}
          className="whitespace-nowrap rounded-full border px-[15px] py-1.5 text-xs font-semibold transition-[filter] hover:brightness-125 disabled:opacity-50"
          style={{
            background: isFollowing ? "rgba(143,220,138,.16)" : "rgba(255,255,255,.04)",
            borderColor: isFollowing ? "rgba(143,220,138,.45)" : "rgba(143,220,138,.25)",
            color: isFollowing ? "#b9eab2" : "#cfe6cb",
          }}
        >
          {isFollowing ? "팔로잉" : "팔로우"}
        </button>
      )}
    </div>
  );
}
