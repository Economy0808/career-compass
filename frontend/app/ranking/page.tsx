"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BeanIcon, Card, EmptyState } from "@/components/ui";
import { getBeanRanking } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import type { BeanRankingEntry } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function RankingPage() {
  const router = useRouter();
  const { me } = useAuth();
  const [entries, setEntries] = useState<BeanRankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBeanRanking()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch(() => {
        if (!cancelled) setError("랭킹을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-serif text-display font-bold text-content-primary">이번 주 콩 랭킹</h1>
      {/* 랭킹 공정성 안내 — 지우지 말 것 */}
      <p className="mt-2 text-body-sm text-content-muted">
        콩나무를 완주해 <b className="text-bloom">직접 수확한 콩</b>만 집계돼요 (충전 콩 제외) ·
        매주 월요일 리셋
      </p>

      {loading && (
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-line bg-surface-raised"
            />
          ))}
        </div>
      )}

      {!loading && error && <p className="mt-8 text-body-sm text-wither">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title="이번 주에는 아직 콩을 수확한 사람이 없어요."
            description="첫 수확의 주인공이 되어보세요."
          />
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="mt-8 flex flex-col gap-2.5">
          {entries.map((entry) => {
            const isTop3 = entry.rank <= 3;
            const isMe = me?.id === entry.user.id;
            return (
              <Card
                key={entry.user.id}
                interactive
                onClick={() => router.push(`/profile/${entry.user.id}`)}
                className={cn(
                  "flex items-center gap-4 px-5 py-3",
                  isTop3 && "border-bloom/35 py-4",
                  isMe && "border-line-strong bg-goal/12"
                )}
              >
                <span
                  className={cn(
                    "w-9 shrink-0 text-center font-serif font-bold",
                    isTop3 ? "text-title" : "text-body text-content-muted"
                  )}
                >
                  {isTop3 ? MEDALS[entry.rank - 1] : entry.rank}
                </span>
                <span className="text-title">{entry.user.avatar_emoji}</span>
                <span
                  className={cn(
                    "min-w-0 truncate text-body-sm font-semibold",
                    isTop3 ? "text-content-primary" : "text-content-secondary"
                  )}
                >
                  {entry.user.display_name}
                  {isMe && <span className="ml-1.5 text-micro text-goal-bright">(나)</span>}
                </span>
                <span
                  className={cn(
                    "ml-auto flex shrink-0 items-center gap-1.5 font-bold",
                    isTop3 ? "text-heading text-bloom" : "text-body-sm text-growth-bright"
                  )}
                >
                  <BeanIcon size={isTop3 ? 17 : 14} />
                  {entry.beans_earned}
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
