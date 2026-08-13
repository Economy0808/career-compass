"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { milestoneSide, milestoneY } from "@/components/BeanstalkCanvas";
import { Button, Chip, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateKo } from "@/lib/format";
import type { MilestoneStatus, UserOut } from "@/lib/types";

/** 콩나무 상세(로드맵/대목표) 두 페이지가 공유하는 조각들. */

/** 상태별 칩 색. 완료=성장, 진행중=목표, 기한초과=시듦. */
const STATUS_TONE = {
  완료: "growth",
  진행중: "goal",
  기한초과: "wither",
} as const satisfies Record<MilestoneStatus, string>;

export function StatusChip({ status }: { status: MilestoneStatus }) {
  return (
    <Chip tone={STATUS_TONE[status]} size="sm" selected>
      {status}
    </Chip>
  );
}

/** 가지 패널 폭(px) — 위치 계산과 클래스가 같은 값을 써야 해서 상수로 둔다. */
const PANEL_W = 292;

/**
 * 첫 진입 시 착지할 스크롤 위치 — 아직 완주하지 않은 가장 아래 가지.
 * 월드 좌표는 `scale`이 곱해진 뒤에야 실제 픽셀이 된다.
 */
export function computeLandingScrollTop(
  count: number,
  firstIncompleteIdx: number,
  clientHeight: number,
  scale: number,
): number {
  if (firstIncompleteIdx < 0) return 0;
  return Math.max(0, milestoneY(count, firstIncompleteIdx) * scale - clientHeight * 0.52);
}

export function CenteredNotice({ tone, title }: { tone: "loading" | "error"; title: string }) {
  return (
    <div className="flex h-dvh items-center justify-center px-4">
      <div className={cn("w-full max-w-sm", tone === "loading" && "animate-pulse")}>
        <EmptyState title={title} />
      </div>
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
  scale,
  children,
}: {
  index: number;
  count: number;
  status: MilestoneStatus;
  scale: number;
  children: ReactNode;
}) {
  const y = milestoneY(count, index) * scale;
  const side = milestoneSide(index);
  // 가지가 줄기에서 뻗는 거리도 scale을 타므로 패널도 같이 당겨온다.
  const reach = 208 * scale;
  return (
    <div
      className="group absolute z-[6] w-[292px] max-w-[calc(100%-32px)]"
      style={{
        // 기한초과 가지는 아래로 처지므로(월드 좌표 76px) 패널도 같은 만큼 따라 내린다.
        top: y - 116 + (status === "기한초과" ? 76 * scale : 0),
        left:
          side === 1
            ? `min(calc(50% + ${reach}px), calc(100% - ${PANEL_W + 16}px))`
            : `max(16px, calc(50% - ${reach + PANEL_W}px))`,
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
        className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-growth/45 bg-surface-overlay text-display no-underline shadow-[0_0_34px_rgba(63,143,71,.28)] transition-shadow hover:shadow-[0_0_44px_rgba(63,143,71,.45)]"
      >
        {user.avatar_emoji}
      </Link>
      <div className="text-body-sm font-bold text-content-primary">{user.display_name}</div>
      <div className="text-caption text-content-muted">
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
    <div className="fixed right-4 top-4 z-[55] flex max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full border border-line bg-surface-overlay py-2 pl-4 pr-2 backdrop-blur-lg md:right-6 md:top-5">
      <Link href={`/profile/${user.id}`} className="flex min-w-0 items-center gap-2 no-underline">
        <span className="text-body">{user.avatar_emoji}</span>
        <span className="truncate text-body-sm font-semibold !text-content-primary hover:!text-goal-bright">
          {label}
        </span>
      </Link>
      {/* 좁은 화면에서는 진행률 문구를 접는다 — 칩이 화면을 가로지르면 안 된다. */}
      <span className="hidden whitespace-nowrap text-caption text-content-muted sm:inline">{sub}</span>
      {canFollow && (
        <Button
          size="sm"
          variant={isFollowing ? "secondary" : "ghost"}
          disabled={followPending}
          onClick={onToggleFollow}
        >
          {isFollowing ? "팔로잉" : "팔로우"}
        </Button>
      )}
    </div>
  );
}
