"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState, type MouseEvent } from "react";
import { Avatar } from "./Avatar";
import { ProgressBar } from "./ProgressBar";
import type { RoadmapCardOut } from "@/lib/types";
import { followUser, unfollowUser } from "@/lib/api";
import { relativeTimeKo } from "@/lib/format";

export function RoadmapCard({
  card,
  currentUserId,
  onFollowChange,
}: {
  card: RoadmapCardOut;
  currentUserId?: number;
  onFollowChange?: (isFollowing: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const isOwnCard = currentUserId === card.user.id;

  async function toggleFollow(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUserId || pending) return;
    setPending(true);
    const next = !card.is_following;
    try {
      if (next) {
        await followUser(card.user.id, currentUserId);
      } else {
        await unfollowUser(card.user.id, currentUserId);
      }
      onFollowChange?.(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <Link href={`/roadmap/${card.id}`} className="block">
      <motion.div
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.99 }}
        className="rounded-3xl border border-border bg-surface p-5 shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar emoji={card.user.avatar_emoji} />
            <div>
              <p className="text-sm font-medium">{card.user.display_name}</p>
              <p className="text-xs text-muted">{relativeTimeKo(card.created_at)}</p>
            </div>
          </div>
          {!isOwnCard && currentUserId !== undefined && (
            <button
              type="button"
              onClick={toggleFollow}
              disabled={pending}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                card.is_following
                  ? "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                  : "bg-ink-900 text-white dark:bg-accent-500 dark:text-ink-950"
              }`}
            >
              {card.is_following ? "팔로잉" : "팔로우"}
            </button>
          )}
        </div>

        <h3 className="mt-4 text-lg font-semibold">{card.title}</h3>

        <div className="mt-3 space-y-1.5">
          <ProgressBar value={card.progress_pct} showLabel />
          <p className="text-xs text-muted">마일스톤 {card.milestone_count}개</p>
        </div>
      </motion.div>
    </Link>
  );
}
