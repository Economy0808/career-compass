"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MiniBeanstalk } from "@/components/MiniBeanstalk";
import { followUser, getFeed, unfollowUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { FeedScope, RoadmapCardOut } from "@/lib/types";

const TABS: { value: FeedScope; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "following", label: "팔로잉" },
];

export default function FeedPage() {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();
  const [scope, setScope] = useState<FeedScope>("all");
  const [cards, setCards] = useState<RoadmapCardOut[]>([]);
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

  async function toggleFollow(card: RoadmapCardOut) {
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
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
      <div className="ml-[230px] mr-10 max-w-[1040px] pb-[90px] pt-[88px]">
        <h1 className="font-serif text-[30px] font-bold text-moss-100">로드맵 숲</h1>
        <p className="mt-[7px] text-[13px] text-moss-600">
          친구들의 콩나무가 자라는 곳 — 눌러서 구경해 보세요
        </p>

        <div className="mb-5 mt-6 flex gap-2">
          {TABS.map((tab) => {
            const active = scope === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setScope(tab.value)}
                className={`whitespace-nowrap rounded-full border px-[18px] py-[7px] text-[12.5px] font-semibold transition-colors ${
                  active
                    ? "border-[rgba(143,220,138,.4)] bg-[rgba(143,220,138,.16)] text-moss-300"
                    : "border-[rgba(143,220,138,.18)] bg-transparent text-moss-500 hover:bg-[rgba(143,220,138,.08)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(252px,1fr))] gap-[18px]">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[280px] animate-pulse rounded-[18px] border border-[rgba(143,220,138,.13)] bg-[rgba(14,33,20,.4)]"
              />
            ))}
          </div>
        )}

        {!loading && error && <p className="text-sm text-wither-300">{error}</p>}

        {!loading && !error && visibleCards.length === 0 && (
          <div className="rounded-[18px] border border-dashed border-[rgba(143,220,138,.2)] p-10 text-center text-sm text-moss-500">
            {scope === "following"
              ? "아직 팔로우한 사람이 없어요. 숲을 둘러보며 함께 자랄 콩나무를 찾아보세요."
              : "아직 심어진 콩나무가 없어요. 첫 씨앗을 심어보세요."}
          </div>
        )}

        {!loading && !error && visibleCards.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(252px,1fr))] gap-[18px]">
            {visibleCards.map((card) => {
              const done = Math.round((card.progress_pct / 100) * card.milestone_count);
              return (
                <div
                  key={card.id}
                  onClick={() => router.push(`/roadmap/${card.id}`)}
                  className="cursor-pointer rounded-[18px] border border-[rgba(143,220,138,.13)] bg-[linear-gradient(180deg,rgba(14,33,20,.55),rgba(8,20,12,.85))] px-[18px] py-4 transition-[border-color,transform] duration-200 hover:-translate-y-[3px] hover:border-[rgba(143,220,138,.4)]"
                >
                  <div className="flex h-[150px] justify-center">
                    <MiniBeanstalk progressPct={card.progress_pct} />
                  </div>
                  <div className="mt-1.5 text-[15px] font-bold leading-[1.4] text-moss-100">
                    {card.title}
                  </div>
                  <div className="mt-[9px] flex items-center gap-[7px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/profile/${card.user.id}`);
                      }}
                      className="flex items-center gap-[7px] rounded-full pr-1 transition-colors hover:text-moss-200"
                    >
                      <span className="text-[15px]">{card.user.avatar_emoji}</span>
                      <span className="text-[12.5px] text-moss-400 hover:underline">
                        {card.user.display_name}
                      </span>
                    </button>
                    <span className="ml-auto text-xs font-semibold text-bean-200">
                      {card.progress_pct}% 자람
                    </span>
                  </div>
                  <div className="mt-3 flex items-center border-t border-[rgba(143,220,138,.1)] pt-3">
                    <span className="text-[11.5px] text-moss-700">
                      마일스톤 {done}/{card.milestone_count}
                    </span>
                    {me?.yonsei_verified && (
                      <button
                        type="button"
                        disabled={followPendingId === card.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFollow(card);
                        }}
                        className="ml-auto whitespace-nowrap rounded-full border px-3.5 py-[5px] text-xs font-semibold transition-[filter] hover:brightness-[1.3] disabled:opacity-50"
                        style={{
                          background: card.is_following ? "rgba(143,220,138,.16)" : "rgba(255,255,255,.03)",
                          borderColor: card.is_following
                            ? "rgba(143,220,138,.45)"
                            : "rgba(143,220,138,.22)",
                          color: card.is_following ? "#b9eab2" : "#9fbfa0",
                        }}
                      >
                        {card.is_following ? "팔로잉" : "팔로우"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
