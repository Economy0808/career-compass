"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Confetti } from "@/components/Confetti";
import { MilestoneItem } from "@/components/MilestoneItem";
import { ProgressBar } from "@/components/ProgressBar";
import { followUser, getRoadmap, patchMilestone, unfollowUser } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { RoadmapDetailOut } from "@/lib/types";

export default function RoadmapDetailPage({ params }: { params: { id: string } }) {
  const roadmapId = Number(params.id);
  const { currentUser } = useUser();

  const [roadmap, setRoadmap] = useState<RoadmapDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingMilestoneId, setPendingMilestoneId] = useState<number | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRoadmap(roadmapId, currentUser?.id)
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
  }, [roadmapId, currentUser?.id]);

  async function toggleMilestone(milestoneId: number, nextCompleted: boolean) {
    setPendingMilestoneId(milestoneId);
    try {
      const res = await patchMilestone(milestoneId, nextCompleted);
      setRoadmap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          progress_pct: res.roadmap_progress_pct,
          milestones: prev.milestones.map((m) => (m.id === milestoneId ? res.milestone : m)),
        };
      });
      if (nextCompleted && res.roadmap_progress_pct >= 100) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 1200);
      }
    } finally {
      setPendingMilestoneId(null);
    }
  }

  async function toggleFollow() {
    if (!roadmap || !currentUser) return;
    setFollowPending(true);
    const next = !roadmap.is_following;
    try {
      if (next) {
        await followUser(roadmap.user.id, currentUser.id);
      } else {
        await unfollowUser(roadmap.user.id, currentUser.id);
      }
      setRoadmap((prev) => (prev ? { ...prev, is_following: next } : prev));
    } finally {
      setFollowPending(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-36 animate-pulse rounded-3xl border border-border bg-ink-50 dark:bg-ink-900" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-3xl border border-border bg-ink-50 dark:bg-ink-900"
          />
        ))}
      </div>
    );
  }

  if (error || !roadmap) {
    return (
      <p className="pt-10 text-center text-sm text-overdue-600">
        {error ?? "로드맵을 찾을 수 없어요."}
      </p>
    );
  }

  const isOwn = currentUser?.id === roadmap.user.id;

  return (
    <div className="space-y-6 pb-10">
      {showConfetti && <Confetti />}

      <div className="space-y-4 rounded-3xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar emoji={roadmap.user.avatar_emoji} size="lg" />
            <div>
              <p className="text-sm font-medium">{roadmap.user.display_name}</p>
              <p className="text-xs text-muted">{roadmap.goal_raw_text}</p>
            </div>
          </div>
          {!isOwn && currentUser && (
            <button
              type="button"
              onClick={toggleFollow}
              disabled={followPending}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                roadmap.is_following
                  ? "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                  : "bg-ink-900 text-white dark:bg-accent-500 dark:text-ink-950"
              }`}
            >
              {roadmap.is_following ? "팔로잉" : "팔로우"}
            </button>
          )}
        </div>

        <h1 className="text-xl font-semibold">{roadmap.title}</h1>
        <ProgressBar value={roadmap.progress_pct} showLabel size="lg" />
      </div>

      <div className="space-y-3">
        {roadmap.milestones.map((m) => (
          <MilestoneItem
            key={m.id}
            milestone={m}
            pending={pendingMilestoneId === m.id}
            onToggle={() => toggleMilestone(m.id, !m.is_completed_manual)}
          />
        ))}
      </div>
    </div>
  );
}
