"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BeanstalkCanvas,
  worldBackground,
  worldHeight,
} from "@/components/BeanstalkCanvas";
import {
  BranchPanel,
  CHIP_STYLE,
  CenteredNotice,
  OwnerChip,
  PlanterInfo,
  computeLandingScrollTop,
} from "@/components/beanstalk-page";
import { getGoal } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useFollowToggle } from "@/lib/use-follow";
import type { GoalDetailOut, MilestoneOut } from "@/lib/types";

/** 관망 콩나무: 소분류 로드맵을 캔버스가 읽는 MilestoneOut 모양으로 합성한다. */
function toCanvasMilestones(goal: GoalDetailOut): MilestoneOut[] {
  return goal.roadmaps.map((r, i) => ({
    id: r.id,
    order_index: i,
    title: r.title,
    description: "",
    detail: null,
    due_date: "",
    is_completed_manual: false,
    completed_at: null,
    status: r.status,
    post: null,
  }));
}

export default function GoalDetailPage({ params }: { params: { id: string } }) {
  const goalId = Number(params.id);
  const router = useRouter();
  const { me } = useAuth();

  const [goal, setGoal] = useState<GoalDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwn = me?.id === goal?.user.id;
  const { followPending, toggleFollow } = useFollowToggle({
    userId: goal?.user.id,
    isFollowing: goal?.is_following,
    enabled: !isOwn && !!me?.yonsei_verified,
    onApplied: (next) => setGoal((prev) => (prev ? { ...prev, is_following: next } : prev)),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;
    didInitialScroll.current = false;
    setLoading(true);
    setError(null);
    getGoal(goalId)
      .then((data) => {
        if (!cancelled) setGoal(data);
      })
      .catch(() => {
        if (!cancelled) setError("대목표를 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [goalId, me?.id]);

  // 첫 진입: 아직 완주하지 않은 가장 아래 로드맵 가지에 착지
  useEffect(() => {
    if (!goal || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = goal.roadmaps.findIndex((r) => r.status !== "완료");
    el.scrollTop = computeLandingScrollTop(goal.roadmaps.length, idx, el.clientHeight);
    didInitialScroll.current = true;
  }, [goal]);

  if (loading) {
    return <CenteredNotice tone="loading">콩나무 숲을 살피는 중…</CenteredNotice>;
  }

  if (error || !goal) {
    return <CenteredNotice tone="error">{error ?? "대목표를 찾을 수 없어요."}</CenteredNotice>;
  }

  const ms = toCanvasMilestones(goal);
  const n = ms.length;
  const H = worldHeight(n);
  const pct = goal.progress_pct;
  const goalSub = `${pct}% 자람 · 로드맵 ${goal.completed_count}/${n}`;
  const allDone = n > 0 && goal.completed_count === n;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative w-full" style={{ height: H, background: worldBackground() }}>
          <BeanstalkCanvas
            milestones={ms}
            progressPct={pct}
            sprout={null}
            celebrating={false}
            celebrationKey={0}
            showTopBloom={allDone}
            fireflies
            swayEnabled
          />

          {/* 대목표 — 구름 위 */}
          <div className="absolute left-1/2 top-[120px] z-[5] w-[620px] max-w-[86vw] -translate-x-1/2 text-center">
            <div className="relative mb-3.5 text-[11.5px] font-semibold tracking-[.22em] text-night-300">
              🎯 대목표
            </div>
            <div className="relative font-serif text-[34px] font-bold leading-[1.45] text-moss-50 [text-shadow:0_2px_24px_rgba(10,30,50,.8)]">
              {goal.title}
            </div>
            <div className="relative mt-3.5 text-[13px] text-[#a8c2b3]">{goalSub}</div>
            {allDone && (
              <div className="relative mt-3.5 inline-block rounded-full border border-[rgba(240,232,180,.45)] bg-[rgba(240,232,180,.13)] px-[18px] py-[7px] text-[12.5px] font-semibold text-bloom-300">
                모든 소목표 콩나무가 다 자랐어요
              </div>
            )}
          </div>

          {/* 가지 옆 패널 = 소분류 로드맵 */}
          {goal.roadmaps.map((r, i) => {
            const chip = CHIP_STYLE[r.status];
            return (
              <BranchPanel key={r.id} index={i} count={n} status={r.status}>
                <div
                  onClick={() => router.push(`/roadmap/${r.id}`)}
                  className="cursor-pointer rounded-[14px] border border-[rgba(143,220,138,.16)] bg-[rgba(7,22,12,.78)] px-4 py-3.5 shadow-[0_8px_26px_rgba(0,0,0,.38)] backdrop-blur-[6px] transition-colors hover:border-[rgba(143,220,138,.35)]"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-serif text-[13px] text-moss-600">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-semibold tracking-[.04em]"
                      style={{ background: chip.bg, color: chip.fg }}
                    >
                      {r.status}
                    </span>
                    {r.is_withered && <span title="시들어버린 콩나무">🥀</span>}
                    <span className="ml-auto text-[11px] font-semibold text-bean-200">
                      {r.progress_pct}%
                    </span>
                  </div>
                  <div className="mb-1 text-[15.5px] font-bold leading-[1.35] text-moss-100">
                    {r.title}
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold text-bean-300/80">
                    이 콩나무 보러 가기 →
                  </div>
                </div>
              </BranchPanel>
            );
          })}

          <PlanterInfo user={goal.user} createdAt={goal.created_at} actionLabel="대목표 세움" />
        </div>
      </div>

      <OwnerChip
        user={goal.user}
        label={isOwn ? "내 대목표" : `${goal.user.display_name}의 대목표`}
        sub={goalSub}
        canFollow={!isOwn && !!me?.yonsei_verified}
        isFollowing={goal.is_following}
        followPending={followPending}
        onToggleFollow={toggleFollow}
      />
    </div>
  );
}
