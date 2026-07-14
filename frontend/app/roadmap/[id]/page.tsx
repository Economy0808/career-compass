"use client";

import { useEffect, useRef, useState } from "react";
import {
  BeanstalkCanvas,
  milestoneSide,
  milestoneY,
  worldBackground,
  worldHeight,
  type SproutState,
} from "@/components/BeanstalkCanvas";
import { followUser, getRoadmap, patchMilestone, unfollowUser } from "@/lib/api";
import { formatDateKo } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type { MilestoneOut, MilestoneStatus, RoadmapDetailOut } from "@/lib/types";

const CHIP_STYLE: Record<MilestoneStatus, { bg: string; fg: string }> = {
  완료: { bg: "rgba(93,179,91,.2)", fg: "#8fdc8a" },
  진행중: { bg: "rgba(143,206,122,.13)", fg: "#c6ddba" },
  기한초과: { bg: "rgba(196,154,90,.18)", fg: "#d8b078" },
};

interface Flags {
  fireflies: boolean;
  sway: boolean;
  celebratePreview: boolean;
}

function sortedMilestones(roadmap: RoadmapDetailOut): MilestoneOut[] {
  return [...roadmap.milestones].sort((a, b) => a.order_index - b.order_index);
}

function computePct(milestones: MilestoneOut[]): number {
  if (milestones.length === 0) return 0;
  return Math.round((100 * milestones.filter((m) => m.status === "완료").length) / milestones.length);
}

export default function RoadmapDetailPage({ params }: { params: { id: string } }) {
  const roadmapId = Number(params.id);
  const { me } = useAuth();

  const [roadmap, setRoadmap] = useState<RoadmapDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [sprout, setSprout] = useState<SproutState | null>(null);
  const [burst, setBurst] = useState(0);
  const [flags, setFlags] = useState<Flags>({ fireflies: true, sway: true, celebratePreview: false });
  const [flagsOpen, setFlagsOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;
    didInitialScroll.current = false;
    setLoading(true);
    setError(null);
    setSprout(null);
    setBurst(0);
    getRoadmap(roadmapId)
      .then((data) => {
        if (!cancelled) setRoadmap(data);
      })
      .catch(() => {
        if (!cancelled) setError("로드맵을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roadmapId, me?.id]);

  // First entry: land on the lowest incomplete milestone (never scrollIntoView).
  useEffect(() => {
    if (!roadmap || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const ms = sortedMilestones(roadmap);
    const idx = ms.findIndex((m) => m.status !== "완료");
    el.scrollTop = idx < 0 ? 0 : Math.max(0, milestoneY(ms.length, idx) - el.clientHeight * 0.52);
    didInitialScroll.current = true;
  }, [roadmap]);

  // Celebration wave lasts ~9s.
  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(0), 9000);
    return () => clearTimeout(timer);
  }, [burst]);

  async function toggleMilestone(m: MilestoneOut) {
    if (!roadmap) return;
    const next = !m.is_completed_manual;
    const today = new Date().toISOString().slice(0, 10);
    const optimisticStatus: MilestoneStatus = next
      ? "완료"
      : m.due_date < today
        ? "기한초과"
        : "진행중";

    const snapshot = roadmap;
    const optimisticMilestones = roadmap.milestones.map((x) =>
      x.id === m.id ? { ...x, is_completed_manual: next, status: optimisticStatus } : x
    );
    const optimisticPct = computePct(optimisticMilestones);
    setRoadmap({ ...roadmap, milestones: optimisticMilestones, progress_pct: optimisticPct });
    if (next) {
      setSprout({ milestoneId: m.id, t: Date.now() });
      if (optimisticPct >= 100) setBurst(Date.now());
    }

    try {
      const res = await patchMilestone(m.id, next);
      setRoadmap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          progress_pct: res.roadmap_progress_pct,
          milestones: prev.milestones.map((x) => (x.id === m.id ? res.milestone : x)),
        };
      });
    } catch {
      setRoadmap(snapshot);
      if (next) setSprout(null);
    }
  }

  async function toggleFollow() {
    if (!roadmap || !me?.yonsei_verified) return;
    setFollowPending(true);
    const next = !roadmap.is_following;
    try {
      if (next) {
        await followUser(roadmap.user.id);
      } else {
        await unfollowUser(roadmap.user.id);
      }
      setRoadmap((prev) => (prev ? { ...prev, is_following: next } : prev));
    } finally {
      setFollowPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="animate-pulse text-sm text-moss-600">콩나무를 살피는 중…</p>
      </div>
    );
  }

  if (error || !roadmap) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-wither-300">{error ?? "로드맵을 찾을 수 없어요."}</p>
      </div>
    );
  }

  const isOwn = me?.id === roadmap.user.id;
  const ms = sortedMilestones(roadmap);
  const n = ms.length;
  const H = worldHeight(n);
  const pct = roadmap.progress_pct;
  const doneCount = ms.filter((m) => m.status === "완료").length;
  const goalSub = `${pct}% 자람 · ${doneCount}/${n} 마일스톤`;
  const preview = flags.celebratePreview && isOwn;
  const showTopBloom = pct >= 100 || preview;
  const celebrating = preview || (burst > 0 && pct >= 100);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative w-full" style={{ height: H, background: worldBackground() }}>
          <BeanstalkCanvas
            milestones={ms}
            progressPct={pct}
            sprout={sprout}
            celebrating={celebrating}
            celebrationKey={preview ? -1 : burst}
            showTopBloom={showTopBloom}
            fireflies={flags.fireflies}
            swayEnabled={flags.sway}
          />

          {/* Goal — above the clouds at the top of the world */}
          <div className="absolute left-1/2 top-[120px] z-[5] w-[620px] max-w-[86vw] -translate-x-1/2 text-center">
            {showTopBloom && (
              <div
                className="pointer-events-none absolute -top-[70px] left-1/2 h-[360px] w-[560px] rounded-full"
                style={{
                  background: "radial-gradient(closest-side, rgba(240,232,180,.3), rgba(240,232,180,0))",
                  animation: "glowPulse 3.6s ease-in-out infinite",
                }}
              />
            )}
            <div className="relative mb-3.5 text-[11.5px] font-semibold tracking-[.22em] text-night-300">
              최종 목표
            </div>
            <div className="relative font-serif text-[34px] font-bold leading-[1.45] text-moss-50 [text-shadow:0_2px_24px_rgba(10,30,50,.8)]">
              {roadmap.goal_raw_text}
            </div>
            <div className="relative mt-3.5 text-[13px] text-[#a8c2b3]">{goalSub}</div>
            {pct >= 100 && (
              <div className="relative mt-3.5 inline-block rounded-full border border-[rgba(240,232,180,.45)] bg-[rgba(240,232,180,.13)] px-[18px] py-[7px] text-[12.5px] font-semibold text-bloom-300">
                콩나무가 다 자랐어요 · 목표 달성
              </div>
            )}
          </div>

          {/* Milestone panels — glass cards beside each branch */}
          {ms.map((m, i) => {
            const y = milestoneY(n, i);
            const side = milestoneSide(i);
            const chip = CHIP_STYLE[m.status];
            const done = m.status === "완료";
            return (
              <div
                key={m.id}
                className="absolute z-[6] w-[292px]"
                style={{
                  top: m.status === "기한초과" ? y - 36 : y - 116,
                  left:
                    side === 1
                      ? "min(calc(50% + 208px), calc(100% - 312px))"
                      : "max(16px, calc(50% - 500px))",
                }}
              >
                <div className="rounded-[14px] border border-[rgba(143,220,138,.16)] bg-[rgba(7,22,12,.78)] px-4 py-3.5 shadow-[0_8px_26px_rgba(0,0,0,.38)] backdrop-blur-[6px]">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-serif text-[13px] text-moss-600">
                      {String(m.order_index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-semibold tracking-[.04em]"
                      style={{ background: chip.bg, color: chip.fg }}
                    >
                      {m.status}
                    </span>
                    <span className="ml-auto text-[11px] text-moss-700">
                      ~ {m.due_date.replace(/-/g, ".")}
                    </span>
                  </div>
                  <div className="mb-1 text-[15.5px] font-bold leading-[1.35] text-moss-100">
                    {m.title}
                  </div>
                  <div className="text-[12.5px] leading-[1.55] text-moss-400">{m.description}</div>
                  {m.status === "기한초과" && (
                    <div className="mt-[7px] text-[11.5px] text-wither-300">
                      괜찮아요 — 지금 완료하면 가지가 다시 자라요.
                    </div>
                  )}
                  {isOwn && (
                    <button
                      type="button"
                      onClick={() => toggleMilestone(m)}
                      className="mt-[11px] inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-3.5 py-[7px] text-[12.5px] font-semibold transition-[filter] hover:brightness-125"
                      style={{
                        background: done ? "rgba(93,179,91,.22)" : "rgba(255,255,255,.04)",
                        borderColor: done ? "rgba(143,220,138,.5)" : "rgba(143,220,138,.26)",
                        color: done ? "#b9eab2" : "#cfe6cb",
                      }}
                    >
                      {done ? "✓ 완료됨" : "완료로 표시"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Ground — where the seed was planted */}
          <div className="absolute bottom-[118px] left-1/2 z-[6] flex -translate-x-1/2 flex-col items-center gap-2 text-center">
            <div className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-[#3f6f49] bg-[rgba(16,36,21,.92)] text-[34px] shadow-[0_0_34px_rgba(93,179,91,.28)]">
              {roadmap.user.avatar_emoji}
            </div>
            <div className="text-sm font-bold text-moss-100">{roadmap.user.display_name}</div>
            <div className="text-[11.5px] text-moss-600">
              {formatDateKo(roadmap.created_at)} 씨앗 심음
            </div>
          </div>
        </div>
      </div>

      {/* Owner chip — fixed to the viewport, top right */}
      <div className="fixed right-[26px] top-[22px] z-[55] flex items-center gap-2.5 rounded-full border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] py-2 pl-[15px] pr-2.5 backdrop-blur-[10px]">
        <span className="text-base">{roadmap.user.avatar_emoji}</span>
        <span className="text-[13px] font-semibold text-moss-100">
          {isOwn ? "내 콩나무" : `${roadmap.user.display_name}의 콩나무`}
        </span>
        <span className="whitespace-nowrap text-[11.5px] text-moss-600">{goalSub}</span>
        {!isOwn && me?.yonsei_verified && (
          <button
            type="button"
            onClick={toggleFollow}
            disabled={followPending}
            className="whitespace-nowrap rounded-full border px-[15px] py-1.5 text-xs font-semibold transition-[filter] hover:brightness-125 disabled:opacity-50"
            style={{
              background: roadmap.is_following ? "rgba(143,220,138,.16)" : "rgba(255,255,255,.04)",
              borderColor: roadmap.is_following ? "rgba(143,220,138,.45)" : "rgba(143,220,138,.25)",
              color: roadmap.is_following ? "#b9eab2" : "#cfe6cb",
            }}
          >
            {roadmap.is_following ? "팔로잉" : "팔로우"}
          </button>
        )}
      </div>

      {/* Ambience toggles */}
      <div className="fixed bottom-[22px] right-[26px] z-[55] flex flex-col items-end gap-2">
        {flagsOpen && (
          <div className="flex flex-col gap-2 rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.85)] p-3.5 text-[12.5px] text-moss-400 backdrop-blur-[10px]">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={flags.fireflies}
                onChange={(e) => setFlags((f) => ({ ...f, fireflies: e.target.checked }))}
                className="accent-bean-500"
              />
              반딧불이
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={flags.sway}
                onChange={(e) => setFlags((f) => ({ ...f, sway: e.target.checked }))}
                className="accent-bean-500"
              />
              꽃 흔들림
            </label>
            {isOwn && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags.celebratePreview}
                  onChange={(e) => setFlags((f) => ({ ...f, celebratePreview: e.target.checked }))}
                  className="accent-bean-500"
                />
                축하 미리보기
              </label>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setFlagsOpen((v) => !v)}
          className="rounded-full border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] px-3.5 py-2 text-xs font-semibold text-moss-500 backdrop-blur-[10px] transition-colors hover:bg-[rgba(143,220,138,.16)] hover:text-moss-300"
        >
          ✦ 분위기
        </button>
      </div>
    </div>
  );
}
