"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui";
import { followUser, getUserProfile, patchMyBio, unfollowUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { UserProfileOut } from "@/lib/types";
import { DangerZone } from "./_components/DangerZone";
import { ProfileHeader } from "./_components/ProfileHeader";

export default function ProfilePage({ params }: { params: { id: string } }) {
  // NOTE: 레거시 백엔드(/api/users/{id})는 여전히 숫자 PK를 쓴다. Firebase uid로
  // 완전히 옮겨가기 전까지는 이 페이지가 숫자 id로만 프로필을 가져올 수 있어,
  // 레거시 API 호출은 그대로 두되(런타임 저하 허용) "내 프로필인지"만 uid로 비교한다.
  const legacyUserId = Number(params.id);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<UserProfileOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);

  const isOwn = user?.uid === params.id;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserProfile(legacyUserId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setError("프로필을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [legacyUserId, user?.uid, authLoading]);

  async function toggleFollow() {
    if (!profile || !user?.yonseiVerified || followPending) return;
    setFollowPending(true);
    const next = !profile.is_following;
    try {
      if (next) await followUser(profile.id);
      else await unfollowUser(profile.id);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              is_following: next,
              follower_count: prev.follower_count + (next ? 1 : -1),
            }
          : prev
      );
    } finally {
      setFollowPending(false);
    }
  }

  async function saveBio(bio: string) {
    const updated = await patchMyBio(bio);
    setProfile(updated);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-sm animate-pulse">
        <EmptyState title="프로필을 살피는 중…" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-sm">
        <EmptyState title={error ?? "유저를 찾을 수 없어요."} />
      </div>
    );
  }

  return (
    <>
      <ProfileHeader
        profile={profile}
        isMe={isOwn}
        canFollow={!isOwn && !!user?.yonseiVerified}
        followPending={followPending}
        onToggleFollow={toggleFollow}
        onSaveBio={saveBio}
      />

      {/* TODO(placeholder): 이 유저가 만든 별자리 목록은 아직 없다.
          예전 "콩나무 목록" 섹션(GoalSection)은 로드맵 API와 함께 통째로 삭제됐고,
          별자리 목록 API가 붙기 전까지는 빈 상태만 보여준다. */}
      <div className="mt-9">
        <h2 className="mb-4 font-serif text-heading font-bold text-text-hi">
          {isOwn ? "내 별자리" : "별자리"}
        </h2>
        <EmptyState
          title="별자리 목록, 준비 중이에요"
          description={isOwn ? "'별자리 생성하기'에서 첫 별자리를 만들어보세요." : undefined}
        />
        {isOwn && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => router.push("/constellation/new")}
              className="text-caption font-semibold text-spec-b hover:brightness-125"
            >
              별자리 생성하러 가기
            </button>
          </div>
        )}
      </div>

      {isOwn && <DangerZone onDeleted={() => router.push("/")} />}
    </>
  );
}
