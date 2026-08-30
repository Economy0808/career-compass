"use client";

/*
 * 탐색 데모 - app/explore/page.tsx의 카드 마크업(초상형 aspect-[3/4], 검색
 * 모드 배지 등)을 그대로 복제하되, 데이터는 lib/demo-fixtures.ts의 고정
 * 목록을 클라이언트에서 필터링한다. 서버 호출 0(핵심 제약).
 */

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import { SearchIcon } from "@/components/ui/icons";
import { DEMO_USERS, demoCommonTags, type DemoUser } from "@/lib/demo-fixtures";

const CHIP_MAX = 4;

function matchesQuery(user: DemoUser, query: string, isIdMode: boolean): boolean {
  if (isIdMode) {
    const handle = query.slice(1).trim().toLowerCase();
    if (!handle) return true;
    return user.displayName.toLowerCase().includes(handle);
  }
  const q = query.toLowerCase();
  return (
    user.displayName.toLowerCase().includes(q) ||
    user.bio.toLowerCase().includes(q) ||
    user.interestTags.some((tag) => tag.toLowerCase().includes(q))
  );
}

function DemoUserCard({
  user,
  following,
  onToggleFollow,
}: {
  user: DemoUser;
  following: boolean;
  onToggleFollow: () => void;
}) {
  const common = new Set(demoCommonTags(user));
  const shownTags = user.interestTags.slice(0, CHIP_MAX);
  const hiddenCount = user.interestTags.length - shownTags.length;

  return (
    <div className="flex aspect-[3/4] flex-col items-center overflow-hidden rounded-xl border border-rule bg-ink-800/70 px-3 py-5 backdrop-blur-[2px] transition-colors hover:bg-ink-800/90">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-[30px] md:h-20 md:w-20 md:text-[34px]">
        {user.avatarEmoji}
      </span>
      <span className="mt-3 w-full shrink-0 truncate text-center font-sans text-body-sm font-semibold text-text-hi">
        {user.displayName}
      </span>
      <span className="mt-1 line-clamp-2 w-full shrink-0 text-center text-caption leading-snug text-text-lo">
        {user.bio}
      </span>
      {shownTags.length > 0 && (
        <span className="mt-2 flex w-full flex-wrap justify-center gap-1">
          {shownTags.map((tag) => (
            <span
              key={tag}
              className={
                "rounded-full border px-2 py-0.5 font-sans text-micro " +
                (common.has(tag) ? "border-lit/60 bg-lit/10 font-medium text-lit" : "border-rule text-text-lo")
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
      <button
        type="button"
        onClick={onToggleFollow}
        className={
          "mt-auto flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border px-3 text-micro font-semibold transition-colors " +
          (following
            ? "border-rule text-text-lo hover:bg-ink-700"
            : "border-transparent bg-spec-b text-ink-900 hover:brightness-110")
        }
      >
        {following ? "팔로잉" : "팔로우"}
      </button>
    </div>
  );
}

export default function DemoExplorePage() {
  const [query, setQuery] = useState("");
  const [followingUids, setFollowingUids] = useState<Set<string>>(new Set());

  const trimmedQuery = query.trim();
  const isIdMode = trimmedQuery.startsWith("@");
  const idHandle = isIdMode ? trimmedQuery.slice(1).trim() : "";

  const filtered = useMemo(() => {
    if (!trimmedQuery) return DEMO_USERS;
    return DEMO_USERS.filter((u) => matchesQuery(u, trimmedQuery, isIdMode));
  }, [trimmedQuery, isIdMode]);

  function toggleFollow(uid: string) {
    setFollowingUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  return (
    <div className="pb-4">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">탐색</h1>
        <p className="text-body-sm text-text-lo">같은 별을 보는 사람을 찾아보세요</p>
      </header>

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

      {filtered.length === 0 ? (
        <EmptyState
          title={isIdMode ? `"@${idHandle}"에 맞는 아이디가 없어요` : `"${trimmedQuery}"와 관련된 사람이 없어요`}
          description={isIdMode ? "다른 아이디로 찾아보세요" : "다른 키워드로 찾아보세요"}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((u) => (
            <DemoUserCard
              key={u.uid}
              user={u}
              following={followingUids.has(u.uid)}
              onToggleFollow={() => toggleFollow(u.uid)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
