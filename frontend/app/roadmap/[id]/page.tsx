"use client";

import { useEffect, useRef, useState } from "react";
import {
  BeanstalkCanvas,
  useCanvasScale,
  worldBackground,
  worldHeight,
  type SproutState,
} from "@/components/BeanstalkCanvas";
import {
  BranchPanel,
  CenteredNotice,
  OwnerChip,
  PlanterInfo,
  StatusChip,
  computeLandingScrollTop,
} from "@/components/beanstalk-page";
import { BeanIcon, Button, Card, CheckIcon, WitherIcon } from "@/components/ui";
import { MilestonePostModal } from "@/components/MilestonePostModal";
import { apiUrl, getRoadmap, patchMilestone } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useFollowToggle } from "@/lib/use-follow";
import type {
  MilestoneOut,
  MilestonePostOut,
  MilestoneStatus,
  RoadmapDetailOut,
} from "@/lib/types";

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
  const [sprout, setSprout] = useState<SproutState | null>(null);
  const [burst, setBurst] = useState(0);
  const [flags, setFlags] = useState<Flags>({ fireflies: true, sway: true, celebratePreview: false });
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [postMilestoneId, setPostMilestoneId] = useState<number | null>(null);
  const [beansNotice, setBeansNotice] = useState<number | null>(null);

  const isOwn = me?.id === roadmap?.user.id;
  const { followPending, toggleFollow } = useFollowToggle({
    userId: roadmap?.user.id,
    isFollowing: roadmap?.is_following,
    enabled: !isOwn && !!me?.yonsei_verified,
    onApplied: (next) =>
      setRoadmap((prev) => (prev ? { ...prev, is_following: next } : prev)),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const measuredScale = useCanvasScale(scrollRef, !loading && !!roadmap);
  const scale = measuredScale ?? 1;

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
  // World coordinates are only final once the canvas scale has been measured.
  useEffect(() => {
    if (!roadmap || measuredScale === null || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const ms = sortedMilestones(roadmap);
    const idx = ms.findIndex((m) => m.status !== "완료");
    el.scrollTop = computeLandingScrollTop(ms.length, idx, el.clientHeight, measuredScale);
    didInitialScroll.current = true;
  }, [roadmap, measuredScale]);

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
      if (res.beans_awarded) {
        setBeansNotice(res.beans_awarded);
        setTimeout(() => setBeansNotice(null), 9000);
      }
    } catch {
      setRoadmap(snapshot);
      if (next) setSprout(null);
    }
  }

  function applyPostChange(milestoneId: number, post: MilestonePostOut | null) {
    setRoadmap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        milestones: prev.milestones.map((m) => (m.id === milestoneId ? { ...m, post } : m)),
      };
    });
  }

  if (loading) {
    return <CenteredNotice tone="loading" title="콩나무를 살피는 중…" />;
  }

  if (error || !roadmap) {
    return <CenteredNotice tone="error" title={error ?? "로드맵을 찾을 수 없어요."} />;
  }

  const ms = sortedMilestones(roadmap);
  const n = ms.length;
  const H = worldHeight(n) * scale;
  const pct = roadmap.progress_pct;
  const doneCount = ms.filter((m) => m.status === "완료").length;
  const goalSub = `${pct}% 자람 · ${doneCount}/${n} 마일스톤`;
  const preview = flags.celebratePreview && isOwn;
  const showTopBloom = pct >= 100 || preview;
  const celebrating = preview || (burst > 0 && pct >= 100);
  const postMilestone = ms.find((m) => m.id === postMilestoneId) ?? null;

  return (
    <div className="relative h-dvh overflow-hidden">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative w-full" style={{ height: H, background: worldBackground(scale) }}>
          <BeanstalkCanvas
            milestones={ms}
            progressPct={pct}
            sprout={sprout}
            celebrating={celebrating}
            celebrationKey={preview ? -1 : burst}
            showTopBloom={showTopBloom}
            fireflies={flags.fireflies}
            swayEnabled={flags.sway}
            scale={scale}
          />

          {/* Goal — above the clouds at the top of the world */}
          <div
            className="absolute left-1/2 z-[5] w-full max-w-[620px] -translate-x-1/2 px-4 text-center"
            style={{ top: 120 * scale }}
          >
            {showTopBloom && (
              <div
                className="pointer-events-none absolute -top-16 left-1/2 h-[360px] w-full max-w-[560px] -translate-x-1/2 rounded-full"
                style={{
                  background: "radial-gradient(closest-side, rgba(226,185,79,.3), rgba(226,185,79,0))",
                  animation: "glowPulse 3.6s ease-in-out infinite",
                }}
              />
            )}
            <div className="relative mb-3.5 text-caption font-semibold tracking-[.22em] text-goal-bright">
              최종 목표
            </div>
            <div className="relative font-serif text-display font-bold leading-[1.45] text-content-primary [text-shadow:0_2px_24px_rgba(10,30,50,.8)]">
              {roadmap.goal_raw_text}
            </div>
            <div className="relative mt-3.5 text-body-sm text-content-secondary">{goalSub}</div>
            {pct >= 100 && (
              <div className="relative mt-3.5 inline-block rounded-full border border-bloom/45 bg-bloom/13 px-4 py-1.5 text-caption font-semibold text-bloom">
                콩나무가 다 자랐어요 · 목표 달성
              </div>
            )}
            {beansNotice !== null && (
              <div className="relative mt-2.5 block">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-bloom/50 bg-bloom/18 px-4 py-1.5 text-body-sm font-bold text-bloom">
                  <BeanIcon size={15} className="text-bloom" />콩 {beansNotice}개 수확!
                </span>
              </div>
            )}
            {roadmap.is_withered && (
              <div className="relative mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-wither/45 bg-wither/13 px-4 py-1.5 text-caption font-semibold text-wither">
                <WitherIcon size={15} />
                시들어버린 콩나무 — 지금이라도 물을 주면 다시 자라요
              </div>
            )}
          </div>

          {/* Milestone panels — glass cards beside each branch */}
          {ms.map((m, i) => {
            const done = m.status === "완료";
            return (
              <BranchPanel key={m.id} index={i} count={n} status={m.status} scale={scale}>
                {/* hover: 폴라로이드 팝오버 (사진 + 문구) */}
                {m.post && (
                  <div className="pointer-events-none absolute -top-2 left-1/2 z-20 hidden w-[230px] -translate-x-1/2 -translate-y-full rotate-[-2deg] group-hover:block">
                    <div className="rounded-md border border-bloom/50 bg-[#f5f2e4] p-2 shadow-overlay">
                      {m.post.has_image && m.post.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={apiUrl(m.post.image_url)}
                          alt=""
                          className="h-[140px] w-full rounded-sm object-cover"
                        />
                      )}
                      {/* 폴라로이드 종이 위 글씨라 유일하게 어두운 잉크색을 쓴다. */}
                      <p className="mt-1.5 px-1 pb-0.5 font-serif text-caption leading-relaxed text-[#3d3b2f]">
                        “{m.post.caption}”
                      </p>
                    </div>
                  </div>
                )}
                {/* 기록이 없어도 마일스톤 가이드(무엇을/어떻게)를 볼 수 있으므로 항상 열린다 */}
                <Card
                  interactive
                  onClick={() => setPostMilestoneId(m.id)}
                  className="shadow-panel"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-serif text-body-sm text-content-muted">
                      {String(m.order_index + 1).padStart(2, "0")}
                    </span>
                    <StatusChip status={m.status} />
                    <span className="ml-auto text-micro text-content-muted">
                      ~ {m.due_date.replace(/-/g, ".")}
                    </span>
                  </div>
                  <div className="mb-1 break-words text-body font-bold leading-[1.35] text-content-primary">
                    {m.title}
                  </div>
                  <div className="line-clamp-2 text-caption leading-[1.55] text-content-secondary">
                    {m.description}
                  </div>
                  <div className="mt-1.5 text-micro font-semibold text-goal-bright">
                    자세히 보기 →
                  </div>
                  {m.status === "기한초과" && (
                    <div className="mt-2 text-micro text-wither">
                      괜찮아요 — 지금 완료하면 가지가 다시 자라요.
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    {isOwn && (
                      <Button
                        size="sm"
                        variant={done ? "secondary" : "ghost"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleMilestone(m);
                        }}
                      >
                        {done && <CheckIcon size={14} />}
                        {done ? "완료됨" : "완료로 표시"}
                      </Button>
                    )}
                    {m.post ? (
                      <span className="ml-auto whitespace-nowrap text-micro text-content-muted">
                        기록 · 🌼 {m.post.like_count} · 💬 {m.post.comment_count}
                      </span>
                    ) : (
                      isOwn && (
                        <span className="ml-auto whitespace-nowrap text-micro text-content-muted transition-colors group-hover:text-content-secondary">
                          기록 남기기
                        </span>
                      )
                    )}
                  </div>
                </Card>
              </BranchPanel>
            );
          })}

          <PlanterInfo user={roadmap.user} createdAt={roadmap.created_at} actionLabel="씨앗 심음" />
        </div>

        {/* 모바일 탭바가 땅을 가리지 않도록 스크롤 월드 아래에 여백을 둔다. */}
        <div
          className="md:h-4"
          style={{ height: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
        />
      </div>

      <OwnerChip
        user={roadmap.user}
        label={isOwn ? "내 콩나무" : `${roadmap.user.display_name}의 콩나무`}
        sub={goalSub}
        canFollow={!isOwn && !!me?.yonsei_verified}
        isFollowing={roadmap.is_following}
        followPending={followPending}
        onToggleFollow={toggleFollow}
      />

      {/* Ambience toggles — stay clear of the mobile tab bar. */}
      <div
        className="fixed right-4 z-[55] flex flex-col items-end gap-2 md:right-6 md:bottom-6"
        style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
      >
        {flagsOpen && (
          <Card className="flex flex-col gap-2 text-body-sm text-content-secondary">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={flags.fireflies}
                onChange={(e) => setFlags((f) => ({ ...f, fireflies: e.target.checked }))}
                className="accent-growth"
              />
              반딧불이
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={flags.sway}
                onChange={(e) => setFlags((f) => ({ ...f, sway: e.target.checked }))}
                className="accent-growth"
              />
              꽃 흔들림
            </label>
            {isOwn && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags.celebratePreview}
                  onChange={(e) => setFlags((f) => ({ ...f, celebratePreview: e.target.checked }))}
                  className="accent-growth"
                />
                축하 미리보기
              </label>
            )}
          </Card>
        )}
        <Button size="sm" variant="ghost" onClick={() => setFlagsOpen((v) => !v)}>
          ✦ 분위기
        </Button>
      </div>

      {postMilestone && (
        <MilestonePostModal
          key={postMilestone.id}
          milestone={postMilestone}
          isOwn={isOwn}
          canInteract={!!me?.yonsei_verified}
          onClose={() => setPostMilestoneId(null)}
          onChanged={(post) => applyPostChange(postMilestone.id, post)}
        />
      )}
    </div>
  );
}
