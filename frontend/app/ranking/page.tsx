"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBeanRanking } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
      <div className="ml-[230px] mr-10 max-w-[680px] pb-[90px] pt-[88px]">
        <h1 className="font-serif text-[30px] font-bold text-moss-100">🫘 이번 주 콩 랭킹</h1>
        <p className="mt-[7px] text-[13px] text-moss-600">
          콩나무를 완주해 <b className="text-bloom-300">직접 수확한 콩</b>만 집계돼요 (충전 콩
          제외) · 매주 월요일 리셋
        </p>

        {loading && (
          <div className="mt-8 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl border border-[rgba(143,220,138,.13)] bg-[rgba(14,33,20,.4)]"
              />
            ))}
          </div>
        )}

        {!loading && error && <p className="mt-8 text-sm text-wither-300">{error}</p>}

        {!loading && !error && entries.length === 0 && (
          <div className="mt-8 rounded-[18px] border border-dashed border-[rgba(143,220,138,.2)] p-10 text-center text-sm text-moss-500">
            이번 주에는 아직 콩을 수확한 사람이 없어요.
            <br />첫 수확의 주인공이 되어보세요 🌱
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="mt-8 flex flex-col gap-2.5">
            {entries.map((entry) => {
              const isTop3 = entry.rank <= 3;
              const isMe = me?.id === entry.user.id;
              return (
                <button
                  key={entry.user.id}
                  type="button"
                  onClick={() => router.push(`/profile/${entry.user.id}`)}
                  className={`flex items-center gap-4 rounded-2xl border px-5 text-left transition-[border-color,transform] duration-200 hover:-translate-y-[2px] ${
                    isTop3
                      ? "border-[rgba(240,232,180,.35)] bg-[linear-gradient(180deg,rgba(40,36,18,.5),rgba(14,20,10,.85))] py-4"
                      : "border-[rgba(143,220,138,.13)] bg-[linear-gradient(180deg,rgba(14,33,20,.45),rgba(8,20,12,.8))] py-3"
                  } ${isMe ? "!border-[rgba(143,220,138,.5)]" : ""} hover:border-[rgba(240,232,180,.5)]`}
                >
                  <span
                    className={`w-9 shrink-0 text-center font-serif font-bold ${
                      isTop3 ? "text-[24px]" : "text-[15px] text-moss-600"
                    }`}
                  >
                    {isTop3 ? MEDALS[entry.rank - 1] : entry.rank}
                  </span>
                  <span className="text-[22px]">{entry.user.avatar_emoji}</span>
                  <span
                    className={`min-w-0 truncate text-[14.5px] font-semibold ${
                      isTop3 ? "text-moss-50" : "text-moss-300"
                    }`}
                  >
                    {entry.user.display_name}
                    {isMe && <span className="ml-1.5 text-[11px] text-bean-200">(나)</span>}
                  </span>
                  <span
                    className={`ml-auto shrink-0 font-bold ${
                      isTop3 ? "text-[17px] text-bloom-300" : "text-[14px] text-bean-200"
                    }`}
                  >
                    🫘 {entry.beans_earned}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
