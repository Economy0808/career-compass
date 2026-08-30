"use client";

/*
 * 탐색 - 관심사 기반 사람 찾기(사용자 지시: "자신의 목적에 맞는 사람을 찾는 식",
 * "너비가 긴 직사각형으로 여러명을 띄우는게 아니라, 크게크게 위아래 길이가 길고
 * 너비가 상대적으로 작은 직사각형으로 프로필사진과 그 사람의 관심사를 띄우는거야").
 *
 * - 상단 검색창(300ms 디바운스). 비우면 추천 목록으로 복귀.
 *   · 일반 키워드 = 이름·소개·관심사 부분일치(관심사 검색 모드).
 *   · `@`로 시작 = 닉네임(표시 이름) 부분일치(아이디 검색 모드). 백엔드
 *     app/api/explore.py의 search_explore_users와 1:1 대응(사용자 원문:
 *     "키워드검색을 하면... 유사한 관심사를 가진 타유저를 띄우고, @표시 붙여서
 *     아이디를 검색하면 비슷한 닉네임의 유저를 띄우기"). 입력창 옆 배지로 현재
 *     모드를 드러내고, 결과 0건은 모드별로 다른 안내 문구를 보여준다.
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

/** 카드당 칩 상한 - 좁은 카드(aspect-[3/4] 유지, 사용자 지시 형태)에서 칩이
 * 넘치며 이름 span을 높이 0까지 압축하던 검수 버그의 방어선. */
const CHIP_MAX = 4;

function UserCard({ user }: { user: ExploreUserDto }) {
  const common = new Set(user.commonTags ?? []);
  const shownTags = user.interestTags.slice(0, CHIP_MAX);
  const hiddenCount = user.interestTags.length - shownTags.length;
  return (
    <Link
      href={`/profile/${user.uid}`}
      className="flex aspect-[3/4] flex-col items-center overflow-hidden rounded-xl border border-rule bg-ink-800/70 px-3 py-5 no-underline backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-[30px] md:h-20 md:w-20 md:text-[34px]">
        {user.avatarEmoji ?? "🔭"}
      </span>
      {/* shrink-0: 내용이 넘칠 때 flex가 텍스트부터 압축해 이름이 사라지는
          것 방지(검수 1번). */}
      <span className="mt-3 w-full shrink-0 truncate text-center font-sans text-body-sm font-semibold text-text-hi">
        {user.displayName ?? "이름 없는 관측자"}
      </span>
      {user.bio && (
        <span className="mt-1 line-clamp-2 w-full shrink-0 text-center text-caption leading-snug text-text-lo">
          {user.bio}
        </span>
      )}
      {/* 관심사 칩 - 발행 별자리 요소 빈도 상위. 공통 태그는 lit(새 별빛). */}
      {shownTags.length > 0 && (
        <span className="mt-auto flex w-full flex-wrap justify-center gap-1 pt-3">
          {shownTags.map((tag) => (
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
          {hiddenCount > 0 && (
            <span className="rounded-full border border-rule px-2 py-0.5 font-mono text-micro text-text-lo">
              +{hiddenCount}
            </span>
          )}
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

  const trimmedQuery = query.trim();
  const isIdMode = trimmedQuery.startsWith("@");
  const idHandle = isIdMode ? trimmedQuery.slice(1).trim() : "";

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

      {/* 검색창 - @로 시작하면 아이디 검색, 아니면 관심사·소개 검색(문법 힌트는
          placeholder + 아래 헬퍼 텍스트, 모드는 입력창 옆 배지로 가시화). */}
      <label className="flex items-center gap-2.5 rounded-lg border border-rule bg-ink-800/70 px-3.5 py-2.5 backdrop-blur-[2px] focus-within:border-spec-b">
        <SearchIcon size={17} className="shrink-0 text-text-lo" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·소개·관심사 검색, @아이디로 찾기"
          maxLength={40}
          aria-label="사람 검색 - 키워드 또는 @아이디"
          className="w-full bg-transparent font-sans text-body-sm text-text-hi placeholder:text-text-lo focus:outline-none"
        />
        {trimmedQuery && (
          <span
            className={
              "shrink-0 rounded-full border px-2 py-0.5 font-sans text-micro font-medium " +
              (isIdMode ? "border-spec-b/60 bg-spec-b/10 text-spec-b" : "border-rule text-text-lo")
            }
          >
            {isIdMode ? "아이디 검색" : "관심사·소개 검색"}
          </span>
        )}
      </label>
      <p className="mb-7 mt-1.5 pl-1 text-micro text-text-lo">
        이름·소개·관심사로 찾고, <span className="text-text-hi">@</span>를 붙이면 아이디로 찾아요
      </p>

      {users === null ? (
        <CardSkeleton />
      ) : users.length === 0 ? (
        <EmptyState
          title={
            error
              ? "목록을 불러오지 못했어요"
              : !trimmedQuery
                ? "아직 보여줄 사람이 없어요"
                : isIdMode
                  ? `"@${idHandle}"에 맞는 아이디가 없어요`
                  : `"${trimmedQuery}"와 관련된 사람이 없어요`
          }
          description={
            error
              ? "잠시 후 다시 시도해주세요"
              : !trimmedQuery
                ? "별자리를 띄우면 관심사가 생기고, 여기에 모여요"
                : isIdMode
                  ? "다른 아이디로 찾아보세요"
                  : "다른 키워드로 찾아보세요"
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
