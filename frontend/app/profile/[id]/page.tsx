"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BeanShopModal } from "@/components/BeanShopModal";
import { MiniBeanstalk } from "@/components/MiniBeanstalk";
import {
  ApiError,
  deleteAccount,
  deleteRoadmap,
  followUser,
  getUserProfile,
  getUserRoadmaps,
  patchMyBio,
  patchRoadmapFeatured,
  unfollowUser,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { RoadmapCardOut, UserProfileOut } from "@/lib/types";

const BEAN_DELETE_COST = 10;

interface GoalGroup {
  title: string | null;
  items: RoadmapCardOut[];
  showHeader: boolean;
}

/** 활성 콩나무를 대목표별로 묶는다. 전부 미분류(레거시)면 헤더 없는 플랫 그리드 유지. */
function groupByMajorGoal(cards: RoadmapCardOut[]): GoalGroup[] {
  const groups: GoalGroup[] = [];
  for (const card of cards) {
    const found = groups.find((g) => g.title === card.major_goal_title);
    if (found) found.items.push(card);
    else groups.push({ title: card.major_goal_title, items: [card], showHeader: false });
  }
  const hasNamed = groups.some((g) => g.title !== null);
  if (!hasNamed) return groups;
  groups.sort((a, b) => Number(a.title === null) - Number(b.title === null));
  return groups.map((g) => ({ ...g, showHeader: true }));
}

export default function ProfilePage({ params }: { params: { id: string } }) {
  const userId = Number(params.id);
  const router = useRouter();
  const { me, loading: authLoading, logout } = useAuth();

  const [profile, setProfile] = useState<UserProfileOut | null>(null);
  const [cards, setCards] = useState<RoadmapCardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [featurePendingId, setFeaturePendingId] = useState<number | null>(null);
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [bioPending, setBioPending] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoadmapCardOut | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPending, setAccountPending] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function confirmDeleteAccount() {
    if (accountPending || !accountPassword) return;
    setAccountPending(true);
    setAccountError(null);
    try {
      await deleteAccount(accountPassword);
      await logout();
      router.push("/");
    } catch (err) {
      setAccountError(err instanceof ApiError ? err.detail : "탈퇴에 실패했어요.");
      setAccountPending(false);
    }
  }

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
        setBioInput(p.bio ?? "");
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
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, is_featured: !next } : c))
      );
    } finally {
      setFeaturePendingId(null);
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

  async function saveBio(e: React.FormEvent) {
    e.preventDefault();
    if (bioPending) return;
    setBioPending(true);
    try {
      const updated = await patchMyBio(bioInput.trim());
      setProfile(updated);
      setEditingBio(false);
    } finally {
      setBioPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
        <p className="animate-pulse text-sm text-moss-600">프로필을 살피는 중…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
        <p className="text-sm text-wither-300">{error ?? "유저를 찾을 수 없어요."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
      <div className="ml-[230px] mr-10 max-w-[1040px] pb-[90px] pt-[88px]">
        {/* 프로필 헤더 */}
        <div className="flex items-start gap-6 rounded-2xl border border-[rgba(143,220,138,.13)] bg-[linear-gradient(180deg,rgba(14,33,20,.55),rgba(8,20,12,.85))] p-7">
          <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-full border-2 border-[#3f6f49] bg-[rgba(16,36,21,.92)] text-[40px] shadow-[0_0_34px_rgba(93,179,91,.28)]">
            {profile.avatar_emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-[26px] font-bold text-moss-100">
                {profile.display_name}
              </h1>
              {profile.yonsei_verified && (
                <span className="rounded-full border border-[rgba(143,220,138,.3)] bg-[rgba(143,220,138,.12)] px-2.5 py-1 text-[10.5px] font-semibold text-bean-200">
                  🌿 연세대 학부생
                </span>
              )}
              {!isOwn && me?.yonsei_verified && (
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={followPending}
                  className="ml-auto whitespace-nowrap rounded-full border px-4 py-1.5 text-xs font-semibold transition-[filter] hover:brightness-125 disabled:opacity-50"
                  style={{
                    background: profile.is_following
                      ? "rgba(143,220,138,.16)"
                      : "rgba(255,255,255,.04)",
                    borderColor: profile.is_following
                      ? "rgba(143,220,138,.45)"
                      : "rgba(143,220,138,.25)",
                    color: profile.is_following ? "#b9eab2" : "#cfe6cb",
                  }}
                >
                  {profile.is_following ? "팔로잉" : "팔로우"}
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-5 text-[12.5px] text-moss-500">
              <span>
                콩나무 <b className="text-moss-300">{profile.roadmap_count}</b>
              </span>
              <span>
                팔로워 <b className="text-moss-300">{profile.follower_count}</b>
              </span>
              <span>
                팔로잉 <b className="text-moss-300">{profile.following_count}</b>
              </span>
              <span>
                🫘 <b className="text-bloom-300">{profile.bean_balance}</b>
                {isOwn && (
                  <button
                    type="button"
                    onClick={() => setShopOpen(true)}
                    className="ml-1.5 rounded-full border border-[rgba(240,232,180,.35)] bg-[rgba(240,232,180,.1)] px-2 py-0.5 text-[10.5px] font-semibold text-bloom-300 transition-colors hover:bg-[rgba(240,232,180,.2)]"
                  >
                    + 충전
                  </button>
                )}
              </span>
            </div>

            {editingBio ? (
              <form onSubmit={saveBio} className="mt-3 flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value.slice(0, 200))}
                  placeholder="나를 소개하는 한두 줄 (200자 이내)"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-2.5 text-[13px] leading-relaxed text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={bioPending}
                    className="rounded-full border border-bean-400 bg-bean-500 px-4 py-1.5 text-[12px] font-bold text-[#f0f7ec] transition-colors hover:bg-[#4aa353] disabled:opacity-50"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBio(false);
                      setBioInput(profile.bio ?? "");
                    }}
                    className="rounded-full border border-[rgba(143,220,138,.25)] px-4 py-1.5 text-[12px] font-semibold text-moss-400 hover:bg-[rgba(143,220,138,.1)]"
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-moss-400">
                {profile.bio ?? (
                  <span className="text-moss-700">
                    {isOwn ? "아직 소개글이 없어요." : "소개글이 없어요."}
                  </span>
                )}
                {isOwn && (
                  <button
                    type="button"
                    onClick={() => setEditingBio(true)}
                    className="ml-2 text-[12px] font-semibold text-moss-600 hover:text-moss-300"
                  >
                    ✎ {profile.bio ? "수정" : "소개글 쓰기"}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>

        {/* 콩나무 목록 (숲 미노출 포함 전부) */}
        <div className="mb-4 mt-9 flex items-center">
          <h2 className="font-serif text-[20px] font-bold text-moss-100">
            {isOwn ? "내 콩나무들" : `${profile.display_name}의 콩나무들`}
          </h2>
          {isOwn && (
            <Link
              href="/new"
              className="ml-auto rounded-full border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] px-4 py-2 text-[12.5px] font-semibold !text-bean-100 no-underline transition-colors hover:bg-[rgba(143,220,138,.25)]"
            >
              + 새 씨앗 심기
            </Link>
          )}
        </div>

        {cards.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[rgba(143,220,138,.2)] p-10 text-center text-sm text-moss-500">
            {isOwn ? "아직 심은 씨앗이 없어요. 첫 콩나무를 심어보세요!" : "아직 심은 콩나무가 없어요."}
          </div>
        ) : (
          groupByMajorGoal(cards.filter((c) => !c.is_withered)).map((group) => (
            <div key={group.title ?? "__ungrouped__"} className="mb-6">
              {group.showHeader && (
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="font-serif text-[16px] font-bold text-[#e2c06e]">
                    {group.title ? `🎯 ${group.title}` : "그 외 콩나무"}
                  </h3>
                  <span className="text-[11.5px] text-moss-700">{group.items.length}그루</span>
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(252px,1fr))] gap-[18px]">
                {group.items.map((card) => {
                  const done = Math.round((card.progress_pct / 100) * card.milestone_count);
                  return (
                    <div
                      key={card.id}
                      onClick={() => router.push(`/roadmap/${card.id}`)}
                      className="cursor-pointer rounded-[18px] border border-[rgba(143,220,138,.13)] bg-[linear-gradient(180deg,rgba(14,33,20,.55),rgba(8,20,12,.85))] px-[18px] py-4 transition-[border-color,transform] duration-200 hover:-translate-y-[3px] hover:border-[rgba(143,220,138,.4)]"
                    >
                      <div className="flex h-[150px] justify-center">
                        <MiniBeanstalk progressPct={card.progress_pct} />
                      </div>
                      <div className="mt-1.5 text-[15px] font-bold leading-[1.4] text-moss-100">
                        {card.title}
                      </div>
                      <div className="mt-[9px] flex items-center gap-[7px]">
                        <span className="text-[11.5px] text-moss-700">
                          마일스톤 {done}/{card.milestone_count}
                        </span>
                        <span className="ml-auto text-xs font-semibold text-bean-200">
                          {card.progress_pct}% 자람
                        </span>
                      </div>
                      {isOwn && (
                        <div className="mt-3 border-t border-[rgba(143,220,138,.1)] pt-3">
                          <label
                            onClick={(e) => e.stopPropagation()}
                            className="flex cursor-pointer items-center gap-2 text-[11.5px] text-moss-500"
                          >
                            <input
                              type="checkbox"
                              checked={card.is_featured}
                              disabled={featurePendingId === card.id}
                              onChange={() => void toggleFeatured(card)}
                              className="accent-bean-500"
                            />
                            메인에 띄우기 (로드맵 숲 노출)
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* 시들어버린 콩나무들 - 마감 +30일 지나도 미완주 */}
        {cards.some((c) => c.is_withered) && (
          <>
            <div className="mb-4 mt-10 flex items-center gap-2">
              <h2 className="font-serif text-[20px] font-bold text-wither-300">
                🥀 시들어버린 콩나무들
              </h2>
              <span className="text-[11.5px] text-moss-700">
                마감이 한 달 넘게 지났어요 — 지금이라도 완주하면 되살아나요
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(252px,1fr))] gap-[18px]">
              {cards
                .filter((c) => c.is_withered)
                .map((card) => {
                  const done = Math.round((card.progress_pct / 100) * card.milestone_count);
                  return (
                    <div
                      key={card.id}
                      onClick={() => router.push(`/roadmap/${card.id}`)}
                      className="cursor-pointer rounded-[18px] border border-[rgba(196,154,90,.25)] bg-[linear-gradient(180deg,rgba(40,32,18,.55),rgba(20,15,8,.85))] px-[18px] py-4 transition-[border-color,transform] duration-200 hover:-translate-y-[3px] hover:border-[rgba(216,176,120,.5)]"
                    >
                      <div className="flex h-[150px] justify-center opacity-60 saturate-[.35] sepia-[.4]">
                        <MiniBeanstalk progressPct={card.progress_pct} />
                      </div>
                      <div className="mt-1.5 flex items-start gap-1.5 text-[15px] font-bold leading-[1.4] text-wither-300">
                        <span>🥀</span>
                        {card.title}
                      </div>
                      <div className="mt-[9px] flex items-center gap-[7px]">
                        <span className="text-[11.5px] text-moss-700">
                          마일스톤 {done}/{card.milestone_count}
                        </span>
                        <span className="ml-auto text-xs font-semibold text-wither-300">
                          {card.progress_pct}%에서 시듦
                        </span>
                      </div>
                      {isOwn && (
                        <div className="mt-3 flex items-center border-t border-[rgba(196,154,90,.15)] pt-3">
                          <span className="text-[11px] text-moss-700">물을 주거나, 정리하거나</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteError(null);
                              setDeleteTarget(card);
                            }}
                            className="ml-auto rounded-full border border-[rgba(216,176,120,.4)] bg-[rgba(196,154,90,.14)] px-3 py-1.5 text-[11.5px] font-semibold text-wither-300 transition-colors hover:bg-[rgba(196,154,90,.28)]"
                          >
                            🫘 {BEAN_DELETE_COST}개로 정리
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {/* 위험 구역 — 회원 탈퇴 (본인만) */}
        {isOwn && (
          <div className="mt-14 rounded-2xl border border-[rgba(196,154,90,.2)] bg-[rgba(20,15,8,.4)] p-5">
            <h2 className="text-[14px] font-bold text-wither-300">위험 구역</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-moss-600">
              회원 탈퇴 시 계정과 모든 콩나무·기록·투두가 영구 삭제되며 되돌릴 수 없어요.
            </p>
            <button
              type="button"
              onClick={() => {
                setAccountPassword("");
                setAccountError(null);
                setAccountModalOpen(true);
              }}
              className="mt-3 rounded-full border border-[rgba(216,176,120,.4)] bg-[rgba(196,154,90,.12)] px-4 py-2 text-[12.5px] font-semibold text-wither-300 transition-colors hover:bg-[rgba(196,154,90,.25)]"
            >
              회원 탈퇴
            </button>
          </div>
        )}
      </div>

      {shopOpen && profile && (
        <BeanShopModal
          currentBalance={profile.bean_balance}
          onClose={() => setShopOpen(false)}
          onPurchased={(newBalance) =>
            setProfile((prev) => (prev ? { ...prev, bean_balance: newBalance } : prev))
          }
        />
      )}

      {accountModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,10,5,.72)] px-4 backdrop-blur-[4px]"
          onClick={() => !accountPending && setAccountModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-2xl border border-[rgba(216,176,120,.3)] bg-[rgba(22,16,8,.97)] p-6 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
          >
            <h2 className="font-serif text-[19px] font-bold text-wither-300">회원 탈퇴</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-moss-400">
              계정과 모든 데이터(콩나무·기록·투두·콩)가 <b className="text-moss-100">영구 삭제</b>
              되고 되돌릴 수 없어요. 계속하려면 비밀번호를 입력해주세요.
            </p>
            <input
              type="password"
              autoFocus
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              placeholder="비밀번호"
              autoComplete="current-password"
              className="mt-4 w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(216,176,120,.5)]"
            />
            {accountError && <p className="mt-2 text-[12px] text-wither-300">{accountError}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={confirmDeleteAccount}
                disabled={accountPending || !accountPassword}
                className="flex-1 rounded-xl border border-[rgba(216,176,120,.5)] bg-[rgba(196,154,90,.22)] p-3 text-sm font-bold text-wither-300 transition-[filter] hover:brightness-125 disabled:opacity-50"
              >
                {accountPending ? "탈퇴 중…" : "영구 탈퇴하기"}
              </button>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                disabled={accountPending}
                className="rounded-xl border border-[rgba(143,220,138,.25)] px-4 text-[13px] font-semibold text-moss-400 transition-colors hover:bg-[rgba(143,220,138,.1)] disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && profile && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,10,5,.72)] px-4 backdrop-blur-[4px]"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-2xl border border-[rgba(216,176,120,.3)] bg-[rgba(22,16,8,.97)] p-6 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
          >
            <h2 className="font-serif text-[19px] font-bold text-wither-300">
              🥀 시든 콩나무 정리
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-moss-400">
              <b className="text-moss-100">{deleteTarget.title}</b>
              을(를) 정리하면 마일스톤과 기록이 모두 사라지고 되돌릴 수 없어요.
            </p>
            <p className="mt-2 text-[12.5px] text-moss-500">
              비용 🫘 {BEAN_DELETE_COST}개 · 보유{" "}
              <b className={profile.bean_balance >= BEAN_DELETE_COST ? "text-bloom-300" : "text-wither-300"}>
                {profile.bean_balance}개
              </b>
            </p>
            {profile.bean_balance < BEAN_DELETE_COST && (
              <p className="mt-2 text-[12px] text-wither-300">
                콩이 부족해요 — 콩나무를 완주해 수확하거나 충전해주세요.
              </p>
            )}
            {deleteError && <p className="mt-2 text-[12px] text-wither-300">{deleteError}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletePending || profile.bean_balance < BEAN_DELETE_COST}
                className="flex-1 rounded-xl border border-[rgba(216,176,120,.5)] bg-[rgba(196,154,90,.22)] p-3 text-sm font-bold text-wither-300 transition-[filter] hover:brightness-125 disabled:opacity-50"
              >
                {deletePending ? "정리 중…" : `🫘 ${BEAN_DELETE_COST}개 쓰고 정리하기`}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-[rgba(143,220,138,.25)] px-4 text-[13px] font-semibold text-moss-400 transition-colors hover:bg-[rgba(143,220,138,.1)]"
              >
                취소
              </button>
            </div>
            {profile.bean_balance < BEAN_DELETE_COST && (
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setShopOpen(true);
                }}
                className="mt-2 w-full rounded-xl border border-[rgba(240,232,180,.35)] bg-[rgba(240,232,180,.1)] p-2.5 text-[12.5px] font-semibold text-bloom-300 transition-colors hover:bg-[rgba(240,232,180,.2)]"
              >
                콩 충전하러 가기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
