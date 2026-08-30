"use client";

/*
 * 스토리 링 줄 - 가로 스크롤 아바타 목록(인스타 관례). 로그인 상태에서만
 * GET /api/stories/ring을 호출한다(401 방어 - 비로그인은 애초에 링 자체가
 * 의미 없다). 본인 항목이 있으면 맨 앞으로 정렬한다. 빈 결과/비로그인이면
 * 컴포넌트 자체가 아무것도 렌더링하지 않는다(레이아웃 자리 차지 금지).
 *
 * 미인증 진입 차단(사용자 지시 8번): 로그인은 했지만 미인증이면 링을 눌러
 * 스토리 뷰어를 여는 것 자체를 막는다. 소셜(FeedView)·프로필 양쪽에서
 * 이 컴포넌트를 재사용하므로 여기 한 곳에서만 막으면 둘 다 커버된다.
 */

import { useEffect, useState } from "react";
import { VerifyGate } from "@/components/VerifyGate";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { getStoryRing, type StoryRingEntryDto } from "@/lib/stories-api";

export interface StoryRingProps {
  /** 클릭 시 열 uid와, 다음/이전 유저 넘김에 필요한 전체 링 목록을 함께 넘긴다. */
  onOpen: (uid: string, ring: StoryRingEntryDto[]) => void;
  className?: string;
}

export function StoryRing({ onOpen, className }: StoryRingProps) {
  const { user } = useAuth();
  const [ring, setRing] = useState<StoryRingEntryDto[] | null>(null);
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      setRing(null);
      return;
    }
    let cancelled = false;
    getStoryRing()
      .then((list) => {
        if (cancelled) return;
        // 본인 항목을 맨 앞으로.
        const sorted = [...list].sort((a, b) =>
          a.uid === user.uid ? -1 : b.uid === user.uid ? 1 : 0
        );
        setRing(sorted);
      })
      .catch(() => {
        if (!cancelled) setRing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!ring || ring.length === 0) return null;

  function handleOpen(uid: string, entries: StoryRingEntryDto[]) {
    if (user && !user.yonseiVerified) {
      setVerifyGateOpen(true);
      return;
    }
    onOpen(uid, entries);
  }

  return (
    <div className={cn("flex gap-4 overflow-x-auto px-1 py-2", className)}>
      {ring.map((entry) => (
        <button
          key={entry.uid}
          type="button"
          onClick={() => handleOpen(entry.uid, ring)}
          className="flex w-16 shrink-0 flex-col items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        >
          <span
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full border-2 bg-ink-800 text-[26px]",
              entry.hasUnseen ? "border-lit" : "border-rule"
            )}
          >
            {entry.avatarEmoji ?? "🔭"}
          </span>
          <span className="w-full truncate text-center font-sans text-micro text-text-lo">
            {entry.displayName ?? "관측자"}
          </span>
        </button>
      ))}
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
    </div>
  );
}
