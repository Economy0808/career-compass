"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MiniBeanstalk } from "@/components/MiniBeanstalk";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Tabs,
  TargetIcon,
  WitherIcon,
} from "@/components/ui";
import { followUser, getFeed, unfollowUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { FeedCardOut, FeedScope } from "@/lib/types";

const TABS = [
  { value: "all", label: "전체" },
  { value: "following", label: "팔로잉" },
] as const satisfies readonly { value: FeedScope; label: string }[];

export default function FeedPage() {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();
  const [scope, setScope] = useState<FeedScope>("all");
  const [cards, setCards] = useState<FeedCardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followPendingId, setFollowPendingId] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFeed({ scope: scope === "following" ? "following" : undefined })
      .then((data) => {
        if (!cancelled) setCards(data);
      })
      .catch(() => {
        if (!cancelled) setError("피드를 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, me?.id, authLoading]);

  async function toggleFollow(card: FeedCardOut) {
    if (!me?.yonsei_verified || followPendingId !== null) return;
    setFollowPendingId(card.id);
    const next = !card.is_following;
    try {
      if (next) {
        await followUser(card.user.id);
      } else {
        await unfollowUser(card.user.id);
      }
      setCards((prev) =>
        prev.map((c) => (c.user.id === card.user.id ? { ...c, is_following: next } : c))
      );
    } finally {
      setFollowPendingId(null);
    }
  }

  // My own beanstalks live under "내 콩나무", not in the forest.
  const visibleCards = cards.filter((c) => c.user.id !== me?.id);

  return (
    <>
      <h1 className="font-serif text-display font-bold text-content-primary">로드맵 숲</h1>
      <p className="mt-[7px] text-body-sm text-content-secondary">
        친구들의 콩나무가 자라는 곳 — 눌러서 구경해 보세요
      </p>

      <div className="mb-5 mt-6">
        <Tabs items={TABS} value={scope} onChange={setScope} />
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-lg border border-line bg-surface-raised"
            />
          ))}
        </div>
      )}

      {!loading && error && <p className="text-body-sm text-wither">{error}</p>}

      {!loading && !error && visibleCards.length === 0 && (
        <EmptyState
          title={
            scope === "following" ? "아직 팔로우한 사람이 없어요" : "아직 심어진 콩나무가 없어요"
          }
          description={
            scope === "following"
              ? "숲을 둘러보며 함께 자랄 콩나무를 찾아보세요."
              : "첫 씨앗을 심어보세요."
          }
        />
      )}

      {!loading && !error && visibleCards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleCards.map((card) => {
            const done = Math.round((card.progress_pct / 100) * card.milestone_count);
            return (
              <Card
                key={`${card.kind}-${card.id}`}
                interactive
                onClick={() =>
                  router.push(card.kind === "goal" ? `/goal/${card.id}` : `/roadmap/${card.id}`)
                }
              >
                <div className="flex justify-center">
                  <MiniBeanstalk progressPct={card.progress_pct} isWithered={card.is_withered} />
                </div>
                <div className="mt-1.5 flex items-start gap-1.5 text-body font-bold text-content-primary">
                  {card.is_withered && (
                    <WitherIcon size={16} className="mt-1 shrink-0 text-wither" />
                  )}
                  {card.kind === "goal" && (
                    <TargetIcon size={16} className="mt-1 shrink-0 text-goal-bright" />
                  )}
                  <span className="min-w-0 break-words">{card.title}</span>
                </div>
                <ProgressBar value={card.progress_pct} className="mt-3" />
                <div className="mt-[9px] flex items-center gap-2">
                  {/* The card itself navigates, so inner controls must not bubble. */}
                  <span className="min-w-0" onClick={(e) => e.stopPropagation()}>
                    <Avatar
                      emoji={card.user.avatar_emoji}
                      name={card.user.display_name}
                      onClick={() => router.push(`/profile/${card.user.id}`)}
                    />
                  </span>
                  <span className="ml-auto shrink-0 text-caption font-semibold text-growth-bright">
                    {card.progress_pct}% 자람
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                  <span className="text-caption text-content-muted">
                    {card.kind === "goal"
                      ? `로드맵 ${card.completed_count ?? 0}/${card.milestone_count}`
                      : `마일스톤 ${done}/${card.milestone_count}`}
                  </span>
                  {me?.yonsei_verified && (
                    <Button
                      size="sm"
                      variant={card.is_following ? "secondary" : "ghost"}
                      className="ml-auto"
                      disabled={followPendingId === card.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFollow(card);
                      }}
                    >
                      {card.is_following ? "팔로잉" : "팔로우"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
