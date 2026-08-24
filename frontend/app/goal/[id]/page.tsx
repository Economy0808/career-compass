"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BeanstalkCanvas,
  useCanvasScale,
  worldBackground,
  worldHeight,
} from "@/components/BeanstalkCanvas";
import {
  BranchPanel,
  CenteredNotice,
  OwnerChip,
  PlanterInfo,
  StatusChip,
  computeLandingScrollTop,
} from "@/components/beanstalk-page";
import { Card, WitherIcon } from "@/components/ui";
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
  const measuredScale = useCanvasScale(scrollRef, !loading && !!goal);
  const scale = measuredScale ?? 1;

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

  // 첫 진입: 아직 완주하지 않은 가장 아래 로드맵 가지에 착지.
  // 월드 스케일이 측정되기 전에는 좌표가 확정되지 않으므로 기다린다.
  useEffect(() => {
    if (!goal || measuredScale === null || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = goal.roadmaps.findIndex((r) => r.status !== "완료");
    el.scrollTop = computeLandingScrollTop(
      goal.roadmaps.length,
      idx,
      el.clientHeight,
      measuredScale,
    );
    didInitialScroll.current = true;
  }, [goal, measuredScale]);

  if (loading) {
    return <CenteredNotice tone="loading" title="콩나무 숲을 살피는 중…" />;
  }

  if (error || !goal) {
    return <CenteredNotice tone="error" title={error ?? "대목표를 찾을 수 없어요."} />;
  }

  const ms = toCanvasMilestones(goal);
  const n = ms.length;
  const H = worldHeight(n) * scale;
  const pct = goal.progress_pct;
  const goalSub = `${pct}% 자람 · 로드맵 ${goal.completed_count}/${n}`;
  const allDone = n > 0 && goal.completed_count === n;

  return (
    <div className="relative h-dvh overflow-hidden">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden canvas-scroll">
        <div className="relative w-full" style={{ height: H, background: worldBackground(scale) }}>
          <BeanstalkCanvas
            milestones={ms}
            progressPct={pct}
            sprout={null}
            celebrating={false}
            celebrationKey={0}
            showTopBloom={allDone}
            fireflies
            swayEnabled
            scale={scale}
          />

          {/* 대목표 — 구름 위 */}
          <div
            className="absolute left-1/2 z-[5] w-full max-w-[620px] -translate-x-1/2 px-4 text-center"
            style={{ top: 120 * scale }}
          >
            <div className="relative mb-3.5 text-caption font-semibold tracking-[.22em] text-goal-bright">
              대목표
            </div>
            <div className="relative font-serif text-display font-bold leading-[1.45] text-content-primary [text-shadow:0_2px_24px_rgb(10_30_50_/_.8)]">
              {goal.title}
            </div>
            <div className="relative mt-3.5 text-body-sm text-content-secondary">{goalSub}</div>
            {allDone && (
              <div className="relative mt-3.5 inline-block rounded-full border border-bloom/45 bg-bloom/13 px-4 py-1.5 text-caption font-semibold text-bloom">
                모든 소목표 콩나무가 다 자랐어요
              </div>
            )}
          </div>

          {/* 가지 옆 패널 = 소분류 로드맵 */}
          {goal.roadmaps.map((r, i) => (
            <BranchPanel key={r.id} index={i} count={n} status={r.status} scale={scale}>
              <Card
                interactive
                onClick={() => router.push(`/roadmap/${r.id}`)}
                className="shadow-panel"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-serif text-body-sm text-content-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <StatusChip status={r.status} />
                  {r.is_withered && (
                    <WitherIcon size={14} className="shrink-0 text-wither" />
                  )}
                  <span className="ml-auto text-micro font-semibold text-growth-bright">
                    {r.progress_pct}%
                  </span>
                </div>
                <div className="mb-1 break-words text-body font-bold leading-[1.35] text-content-primary">
                  {r.title}
                </div>
                <div className="mt-1.5 text-micro font-semibold text-goal-bright">
                  이 콩나무 보러 가기 →
                </div>
              </Card>
            </BranchPanel>
          ))}

          <PlanterInfo user={goal.user} createdAt={goal.created_at} actionLabel="대목표 세움" />
        </div>

        {/* 모바일 탭바가 땅을 가리지 않도록 스크롤 월드 아래에 여백을 둔다. */}
        <div
          className="md:h-4"
          style={{ height: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
        />
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
