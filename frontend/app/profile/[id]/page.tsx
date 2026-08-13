"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BeanShopModal } from "@/components/BeanShopModal";
import { Button, EmptyState, Modal } from "@/components/ui";
import {
  ApiError,
  deleteRoadmap,
  followUser,
  getUserProfile,
  getUserRoadmaps,
  patchGoalFeatured,
  patchMyBio,
  patchRoadmapFeatured,
  unfollowUser,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { RoadmapCardOut, UserProfileOut } from "@/lib/types";
import { DangerZone } from "./_components/DangerZone";
import { GoalSection } from "./_components/GoalSection";
import { ProfileHeader } from "./_components/ProfileHeader";

const BEAN_DELETE_COST = 10;

export default function ProfilePage({ params }: { params: { id: string } }) {
  const userId = Number(params.id);
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<UserProfileOut | null>(null);
  const [cards, setCards] = useState<RoadmapCardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [featurePendingId, setFeaturePendingId] = useState<number | null>(null);
  const [goalFeaturePendingId, setGoalFeaturePendingId] = useState<number | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoadmapCardOut | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOwn = me?.id === userId;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getUserProfile(userId), getUserRoadmaps(userId)])
      .then(([p, r]) => {
        if (cancelled) return;
        setProfile(p);
        setCards(r);
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
  }, [userId, me?.id, authLoading]);

  async function toggleFollow() {
    if (!profile || !me?.yonsei_verified || followPending) return;
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

  async function toggleFeatured(card: RoadmapCardOut) {
    if (featurePendingId !== null) return;
    setFeaturePendingId(card.id);
    const next = !card.is_featured;
    // 낙관적 업데이트 - 실패 시 원복
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, is_featured: next } : c)));
    try {
      await patchRoadmapFeatured(card.id, next);
    } catch {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, is_featured: !next } : c)));
    } finally {
      setFeaturePendingId(null);
    }
  }

  async function toggleGoalFeatured(goalId: number, current: boolean) {
    if (goalFeaturePendingId !== null) return;
    setGoalFeaturePendingId(goalId);
    const next = !current;
    const apply = (value: boolean) => (prev: RoadmapCardOut[]) =>
      prev.map((c) => (c.major_goal_id === goalId ? { ...c, major_goal_featured: value } : c));
    // 낙관적 업데이트 - 실패 시 원복
    setCards(apply(next));
    try {
      await patchGoalFeatured(goalId, next);
    } catch {
      setCards(apply(current));
    } finally {
      setGoalFeaturePendingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteRoadmap(deleteTarget.id);
      setCards((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              bean_balance: prev.bean_balance - BEAN_DELETE_COST,
              roadmap_count: prev.roadmap_count - 1,
            }
          : prev
      );
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.detail : "정리에 실패했어요.");
    } finally {
      setDeletePending(false);
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

  const canAfford = profile.bean_balance >= BEAN_DELETE_COST;

  return (
    <>
      <ProfileHeader
        profile={profile}
        isMe={isOwn}
        canFollow={!isOwn && !!me?.yonsei_verified}
        followPending={followPending}
        onToggleFollow={toggleFollow}
        onOpenShop={() => setShopOpen(true)}
        onSaveBio={saveBio}
      />

      <GoalSection
        cards={cards}
        isMe={isOwn}
        displayName={profile.display_name}
        featurePendingId={featurePendingId}
        goalFeaturePendingId={goalFeaturePendingId}
        beanDeleteCost={BEAN_DELETE_COST}
        onToggleFeatured={(card) => void toggleFeatured(card)}
        onToggleGoalFeatured={(goalId, current) => void toggleGoalFeatured(goalId, current)}
        onRequestDelete={(card) => {
          setDeleteError(null);
          setDeleteTarget(card);
        }}
      />

      {isOwn && <DangerZone onDeleted={() => router.push("/")} />}

      {shopOpen && (
        <BeanShopModal
          currentBalance={profile.bean_balance}
          onClose={() => setShopOpen(false)}
          onPurchased={(newBalance) =>
            setProfile((prev) => (prev ? { ...prev, bean_balance: newBalance } : prev))
          }
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="시든 콩나무 정리"
        size="sm"
      >
        {deleteTarget && (
          <>
            <p className="text-body-sm leading-relaxed text-content-secondary">
              <b className="text-content-primary">{deleteTarget.title}</b>을(를) 정리하면 마일스톤과
              기록이 모두 사라지고 되돌릴 수 없어요.
            </p>
            <p className="mt-2 text-caption text-content-muted">
              비용 콩 {BEAN_DELETE_COST}개 · 보유{" "}
              <b className={canAfford ? "text-bloom" : "text-wither"}>{profile.bean_balance}개</b>
            </p>
            {!canAfford && (
              <p className="mt-2 text-caption text-wither">
                콩이 부족해요 — 콩나무를 완주해 수확하거나 충전해주세요.
              </p>
            )}
            {deleteError && <p className="mt-2 text-caption text-wither">{deleteError}</p>}
            <div className="mt-5 flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                onClick={confirmDelete}
                disabled={deletePending || !canAfford}
              >
                {deletePending ? "정리 중…" : `콩 ${BEAN_DELETE_COST}개 쓰고 정리하기`}
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                취소
              </Button>
            </div>
            {!canAfford && (
              <Button
                variant="secondary"
                fullWidth
                className="mt-2"
                onClick={() => {
                  setDeleteTarget(null);
                  setShopOpen(true);
                }}
              >
                콩 충전하러 가기
              </Button>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
