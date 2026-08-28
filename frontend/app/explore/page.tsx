"use client";

/*
 * 탐색 - 관심사 기반 사람 찾기(사용자 지시: "자신의 목적에 맞는 사람을 찾는 식",
 * "너비가 긴 직사각형으로 여러명을 띄우는게 아니라, 크게크게 위아래 길이가 길고
 * 너비가 상대적으로 작은 직사각형으로 프로필사진과 그 사람의 관심사를 띄우는거야").
 *
 * - 상단 검색창(이름 prefix, 300ms 디바운스). 비우면 추천 목록으로 복귀.
 * - 초상형 세로 카드 그리드 - 가로로 긴 행 금지. 카드 = 큰 아바타·이름·bio·
 *   관심사 칩. 나와 겹치는 태그(commonTags)는 lit 칩으로 강조(새 별빛 어휘).
 * - 카드 클릭 → 프로필. 익명도 열람 가능(요청에 토큰이 없으면 서버가 최신순).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { SearchIcon } from "@/components/ui/icons";
import { listExploreUsers, searchExploreUsers, type ExploreUserDto } from "@/lib/explore-api";

const SEARCH_DEBOUNCE_MS = 300;

function CardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] animate-pulse rounded-xl border border-rule bg-ink-800/70" />
      ))}
    </div>
  );
}

function UserCard({ user }: { user: ExploreUserDto }) {
  const common = new Set(user.commonTags ?? []);
  return (
    <Link
      href={`/profile/${user.uid}`}
      className="flex aspect-[3/4] flex-col items-center overflow-hidden rounded-xl border border-rule bg-ink-800/70 px-3 py-5 no-underline backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-[30px] md:h-20 md:w-20 md:text-[34px]">
        {user.avatarEmoji ?? "🔭"}
      </span>
      <span className="mt-3 w-full truncate text-center font-sans text-body-sm font-semibold text-text-hi">
        {user.displayName ?? "이름 없는 관측자"}
      </span>
      {user.bio && (
        <span className="mt-1 line-clamp-2 w-full text-center text-caption leading-snug text-text-lo">
          {user.bio}
        </span>
      )}
      {/* 관심사 칩 - 발행 별자리 요소 빈도 상위. 공통 태그는 lit(새 별빛). */}
      {user.interestTags.length > 0 && (
        <span className="mt-auto flex w-full flex-wrap justify-center gap-1 pt-3">
          {user.interestTags.map((tag) => (
            <span
              key={tag}
              className={
                "rounded-full border px-2 py-0.5 font-sans text-micro " +
                (common.has(tag)
                  ? "border-lit/60 bg-lit/10 font-medium text-lit"
                  : "border-rule text-text-lo")
              }
            >
              {tag}
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ExploreUserDto[] | null>(null);
  const [error, setError] = useState(false);
  // 응답 역전 방지 - 마지막 요청만 반영한다.
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    const q = query.trim();
    setUsers(null);
    setError(false);
    const timer = setTimeout(
      () => {
        (q ? searchExploreUsers(q) : listExploreUsers())
          .then((list) => {
            if (requestSeq.current === seq) setUsers(list);
          })
          .catch(() => {
            if (requestSeq.current === seq) {
              setUsers([]);
              setError(true);
            }
          });
      },
      q ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">탐색</h1>
        <p className="text-body-sm text-text-lo">같은 별을 보는 사람을 찾아보세요</p>
      </header>

      {/* 검색창 */}
      <label className="mb-7 flex items-center gap-2.5 rounded-lg border border-rule bg-ink-800/70 px-3.5 py-2.5 backdrop-blur-[2px] focus-within:border-spec-b">
        <SearchIcon size={17} className="shrink-0 text-text-lo" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 검색"
          maxLength={40}
          aria-label="사람 검색"
          className="w-full bg-transparent font-sans text-body-sm text-text-hi placeholder:text-text-lo focus:outline-none"
        />
      </label>

      {users === null ? (
        <CardSkeleton />
      ) : users.length === 0 ? (
        <EmptyState
          title={error ? "목록을 불러오지 못했어요" : query.trim() ? "검색 결과가 없어요" : "아직 보여줄 사람이 없어요"}
          description={
            error
              ? "잠시 후 다시 시도해주세요"
              : query.trim()
                ? "다른 이름으로 찾아보세요"
                : "별자리를 띄운 관측자들이 여기에 모여요"
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {users.map((u) => (
            <UserCard key={u.uid} user={u} />
          ))}
        </div>
      )}
    </div>
  );
}
