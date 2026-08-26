"use client";

import { useState } from "react";
import { Button, Card, Chip, Field } from "@/components/ui";
import type { UserProfileOut } from "@/lib/types";

export interface ProfileHeaderProps {
  profile: UserProfileOut;
  isMe: boolean;
  canFollow: boolean;
  followPending: boolean;
  onToggleFollow: () => void;
  onSaveBio: (bio: string) => Promise<void>;
}

export function ProfileHeader({
  profile,
  isMe,
  canFollow,
  followPending,
  onToggleFollow,
  onSaveBio,
}: ProfileHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [bioInput, setBioInput] = useState(profile.bio ?? "");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await onSaveBio(bioInput.trim());
      setEditing(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:gap-6">
      {/* 아바타 이모지는 사용자 콘텐츠라 아이콘으로 바꾸지 않는다. */}
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-lit/45 bg-ink-900 text-display shadow-glow">
        {profile.avatar_emoji}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words font-serif text-title font-bold text-text-hi">
            {profile.display_name}
          </h1>
          {profile.yonsei_verified && (
            <Chip tone="growth" size="sm" selected>
              연세대 학부생
            </Chip>
          )}
          {canFollow && (
            <Button
              size="sm"
              variant={profile.is_following ? "secondary" : "ghost"}
              className="ml-auto"
              disabled={followPending}
              onClick={onToggleFollow}
            >
              {profile.is_following ? "팔로잉" : "팔로우"}
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-text-lo">
          <span>
            팔로워 <b className="text-text-lo">{profile.follower_count}</b>
          </span>
          <span>
            팔로잉 <b className="text-text-lo">{profile.following_count}</b>
          </span>
        </div>

        {editing ? (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
            <Field
              id="profile-bio"
              label="소개글"
              multiline
              rows={2}
              autoFocus
              value={bioInput}
              onChange={(e) => setBioInput(e.target.value.slice(0, 200))}
              placeholder="나를 소개하는 한두 줄 (200자 이내)"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                저장
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setBioInput(profile.bio ?? "");
                }}
              >
                취소
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-4 break-words text-body-sm leading-relaxed text-text-lo">
            {profile.bio ?? (
              <span className="text-text-lo">
                {isMe ? "아직 소개글이 없어요." : "소개글이 없어요."}
              </span>
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-2 text-caption font-semibold text-spec-b hover:brightness-125"
              >
                {profile.bio ? "수정" : "소개글 쓰기"}
              </button>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}
