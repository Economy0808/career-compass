"use client";

import { useState } from "react";
import { followUser, unfollowUser } from "@/lib/api";

interface UseFollowToggleOptions {
  /** 팔로우 대상 유저 id. 데이터 로딩 전이면 undefined. */
  userId: number | undefined;
  isFollowing: boolean | null | undefined;
  /** 본인 콩나무가 아니고 인증된 유저일 때만 true. */
  enabled: boolean;
  /** 낙관적 갱신 — 각 페이지가 자기 상태 모양대로 반영한다. */
  onApplied: (next: boolean) => void;
}

/** 콩나무 상세 페이지들이 공유하는 팔로우 토글 (중복 요청 가드 포함). */
export function useFollowToggle({
  userId,
  isFollowing,
  enabled,
  onApplied,
}: UseFollowToggleOptions): { followPending: boolean; toggleFollow: () => Promise<void> } {
  const [followPending, setFollowPending] = useState(false);

  async function toggleFollow(): Promise<void> {
    if (!enabled || userId === undefined || followPending) return;
    setFollowPending(true);
    const next = !isFollowing;
    try {
      if (next) {
        await followUser(userId);
      } else {
        await unfollowUser(userId);
      }
      onApplied(next);
    } finally {
      setFollowPending(false);
    }
  }

  return { followPending, toggleFollow };
}
