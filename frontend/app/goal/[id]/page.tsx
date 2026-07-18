"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BeanstalkCanvas,
  milestoneSide,
  milestoneY,
  worldBackground,
  worldHeight,
} from "@/components/BeanstalkCanvas";
import { followUser, getGoal, unfollowUser } from "@/lib/api";
import { formatDateKo } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type { GoalDetailOut, MilestoneOut, MilestoneStatus } from "@/lib/types";

const CHIP_STYLE: Record<MilestoneStatus, { bg: string; fg: string }> = {
  완료: { bg: "rgba(93,179,91,.2)", fg: "#8fdc8a" },
  진행중: { bg: "rgba(143,206,122,.13)", fg: "#c6ddba" },
  기한초과: { bg: "rgba(196,154,90,.18)", fg: "#d8b078" },
};

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
  const [followPending, setFollowPending] = useState(false);

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
    el.scrollTop =
      idx < 0 ? 0 : Math.max(0, milestoneY(goal.roadmaps.length, idx) - el.clientHeight * 0.52);
    didInitialScroll.current = true;
  }, [goal]);

  async function toggleFollow() {
    if (!goal || !me?.yonsei_verified) return;
    setFollowPending(true);
    const next = !goal.is_following;
    try {
      if (next) {
        await followUser(goal.user.id);
      } else {
        await unfollowUser(goal.user.id);
      }
      setGoal((prev) => (prev ? { ...prev, is_following: next } : prev));
    } finally {
      setFollowPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="animate-pulse text-sm text-moss-600">콩나무 숲을 살피는 중…</p>
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-wither-300">{error ?? "대목표를 찾을 수 없어요."}</p>
      </div>
    );
  }

  const isOwn = me?.id === goal.user.id;
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
            const y = milestoneY(n, i);
            const side = milestoneSide(i);
            const chip = CHIP_STYLE[r.status];
            return (
              <div
                key={r.id}
                className="group absolute z-[6] w-[292px]"
                style={{
                  top: r.status === "기한초과" ? y - 36 : y - 116,
                  left:
                    side === 1
                      ? "min(calc(50% + 208px), calc(100% - 312px))"
                      : "max(16px, calc(50% - 500px))",
                }}
              >
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
              </div>
            );
          })}

          {/* 땅 — 심은 사람 */}
          <div className="absolute bottom-[118px] left-1/2 z-[6] flex -translate-x-1/2 flex-col items-center gap-2 text-center">
            <Link
              href={`/profile/${goal.user.id}`}
              className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-[#3f6f49] bg-[rgba(16,36,21,.92)] text-[34px] no-underline shadow-[0_0_34px_rgba(93,179,91,.28)] transition-shadow hover:shadow-[0_0_44px_rgba(93,179,91,.45)]"
            >
              {goal.user.avatar_emoji}
            </Link>
            <div className="text-sm font-bold text-moss-100">{goal.user.display_name}</div>
            <div className="text-[11.5px] text-moss-600">
              {formatDateKo(goal.created_at)} 대목표 세움
            </div>
          </div>
        </div>
      </div>

      {/* 소유자 칩 — 우상단 고정 */}
      <div className="fixed right-[26px] top-[22px] z-[55] flex items-center gap-2.5 rounded-full border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] py-2 pl-[15px] pr-2.5 backdrop-blur-[10px]">
        <Link href={`/profile/${goal.user.id}`} className="flex items-center gap-2.5 no-underline">
          <span className="text-base">{goal.user.avatar_emoji}</span>
          <span className="text-[13px] font-semibold !text-moss-100 hover:!text-moss-300">
            {isOwn ? "내 대목표" : `${goal.user.display_name}의 대목표`}
          </span>
        </Link>
        <span className="whitespace-nowrap text-[11.5px] text-moss-600">{goalSub}</span>
        {!isOwn && me?.yonsei_verified && (
          <button
            type="button"
            onClick={toggleFollow}
            disabled={followPending}
            className="whitespace-nowrap rounded-full border px-[15px] py-1.5 text-xs font-semibold transition-[filter] hover:brightness-125 disabled:opacity-50"
            style={{
              background: goal.is_following ? "rgba(143,220,138,.16)" : "rgba(255,255,255,.04)",
              borderColor: goal.is_following ? "rgba(143,220,138,.45)" : "rgba(143,220,138,.25)",
              color: goal.is_following ? "#b9eab2" : "#cfe6cb",
            }}
          >
            {goal.is_following ? "팔로잉" : "팔로우"}
          </button>
        )}
      </div>
    </div>
  );
}
