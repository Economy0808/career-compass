"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { RoadmapCard } from "@/components/RoadmapCard";
import { getFeed } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { FeedScope, RoadmapCardOut } from "@/lib/types";

const TABS: { value: FeedScope; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "following", label: "팔로잉" },
];

export default function FeedPage() {
  const { currentUser, loading: userLoading } = useUser();
  const [scope, setScope] = useState<FeedScope>("all");
  const [cards, setCards] = useState<RoadmapCardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFeed({ viewerId: currentUser?.id, scope: scope === "following" ? "following" : undefined })
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
  }, [scope, currentUser?.id, userLoading]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setScope(tab.value)}
            className={`rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
              scope === tab.value
                ? "bg-ink-900 text-white dark:bg-accent-500 dark:text-ink-950"
                : "border border-border bg-surface text-ink-600 dark:text-ink-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-3xl border border-border bg-ink-50 dark:bg-ink-900"
            />
          ))}
        </div>
      )}

      {!loading && error && <p className="text-sm text-overdue-600">{error}</p>}

      {!loading && !error && cards.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted">
          {scope === "following"
            ? "아직 팔로우한 사람이 없어요. 피드를 둘러보며 함께 갈 사람을 찾아보세요."
            : "아직 등록된 로드맵이 없어요. 첫 번째 로드맵을 만들어보세요."}
        </div>
      )}

      {!loading && !error && cards.length > 0 && (
        <div className="grid gap-4">
          {cards.map((card, i) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <RoadmapCard
                card={card}
                currentUserId={currentUser?.id}
                onFollowChange={(next) =>
                  setCards((prev) =>
                    prev.map((c) => (c.id === card.id ? { ...c, is_following: next } : c))
                  )
                }
              />
            </motion.div>
          ))}
        </div>
      )}

      <Link
        href="/new"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-2xl leading-none text-white shadow-soft dark:bg-accent-500 dark:text-ink-950"
        aria-label="새 로드맵 만들기"
      >
        +
      </Link>
    </div>
  );
}
