"use client";

/*
 * 프로필 - 인스타그램 해부학을 우리 관측 세계 토큰으로 옮긴 화면(사용자
 * 벤치마크 지시): 좌측 큰 아바타 · 이름 줄 · 통계 줄 · bio · 탭 줄(사진/별자리)
 * · 정사각 3열 그리드. 게시물의 주인공은 사진(+짤막한 글)이고, 발행한 별자리는
 * 두 번째 탭으로 물러난다.
 *
 * 설계 여지(지금 만들지 않음 - 사용자 지시 "염두에 두고 설계"):
 * - 스토리: 아바타의 링이 스토리 링 자리다(현재는 장식 헤어라인). 하이라이트
 *   줄은 헤더와 탭 사이에 들어갈 예정.
 * - DM: 타인 프로필의 팔로우 버튼 옆이 "메시지" 버튼 자리다.
 * - 음악/노트 짧은 공유: 게시물 타입 확장(PostDto에 kind 추가)으로 수용한다.
 *
 * 이미지는 Storage(Blaze) 전까지 data URL로 문서에 저장된다 - 업로드 전에
 * 클라이언트에서 1080px/JPEG로 리사이즈해 1MiB 문서 한도를 지킨다(fileToDataUrl).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Modal } from "@/components/ui";
import { MiniConstellation } from "@/components/MiniConstellation";
import { listUserConstellations, type ConstellationDto } from "@/lib/constellation-api";
import { getProfile, followUser, unfollowUser, type ProfileDto } from "@/lib/profiles-api";
import { createPost, listUserPosts, type PostDto } from "@/lib/posts-api";
import { PostDetail } from "@/components/PostDetail";
import { createStory, listUserStories } from "@/lib/stories-api";
import { fileToDataUrl } from "@/lib/image-utils";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StoryRing } from "@/components/StoryRing";
import { StoryViewer } from "@/components/StoryViewer";
import type { StoryRingEntryDto } from "@/lib/stories-api";
import { AccountDeleteModal } from "./_components/DangerZone";

const SKELETON_TILES = 9;
const CAPTION_MAX = 500;
const POST_IMAGES_MAX = 10;

/** 다중 장 타일 배지 - 인스타식 겹친 사각형. */
function MultiImageIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="8" y="3.5" width="12.5" height="12.5" rx="2" />
      <path d="M16 20.5 H5.5 A2 2 0 0 1 3.5 18.5 V8" />
    </svg>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1" aria-hidden>
      {Array.from({ length: SKELETON_TILES }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse bg-ink-800/70" />
      ))}
    </div>
  );
}

/** 정사각 3x3 그리드 아이콘(사진 탭). */
function GridIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 4h16v16H4Z M4 10.7h16 M4 17.3h16 M10.7 4v16 M17.3 4v16" />
    </svg>
  );
}

/** 4점 별 아이콘(별자리 탭). */
function StarTabIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5 L14 10 L20.5 12 L14 14 L12 20.5 L10 14 L3.5 12 L10 10 Z" />
    </svg>
  );
}

/** 케밥(세로 점 3개) 아이콘. */
function KebabIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5.5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="18.5" r="1.7" />
    </svg>
  );
}

function ConstellationTile({ item }: { item: ConstellationDto }) {
  return (
    <Link
      href={`/constellation/${item.id}`}
      className="group relative block aspect-square overflow-hidden bg-ink-900 no-underline transition-transform duration-150 hover:scale-[1.02]"
    >
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
      <MiniConstellation
        nodes={item.nodes}
        edges={item.edges}
        groups={item.groups}
        className="absolute inset-0 h-full w-full p-3"
      />
      {/* 인스타 타일처럼 캡션은 밖에 안 두고 hover 오버레이로만 */}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink-900/85 to-transparent px-2 pb-1.5 pt-5 text-caption text-text-hi opacity-0 transition-opacity group-hover:opacity-100">
        {item.title}
      </span>
    </Link>
  );
}

export default function ProfilePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isOwn = !authLoading && user?.uid === params.id;

  const [tab, setTab] = useState<"photos" | "constellations">("photos");
  const [posts, setPosts] = useState<PostDto[] | null>(null);
  // 게시물 fetch가 401이면(비로그인) "게시물 없음"이 아니라 로그인 유도를
  // 보여준다 - 잠금 패널 디자인 없이 그리드 자리를 EmptyState로 대체(사용자 지시).
  const [postsAuthRequired, setPostsAuthRequired] = useState(false);
  const [items, setItems] = useState<ConstellationDto[] | null>(null);
  const [profile, setProfile] = useState<ProfileDto | undefined>(undefined);
  const [followPending, setFollowPending] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  // 케밥 메뉴/모달/컴포저/라이트박스 상태
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState<{ images: string[]; caption: string } | null>(null);
  const [draftPreviewIdx, setDraftPreviewIdx] = useState(0);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<PostDto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 업로드 선택 시트("새 게시물" 타일 클릭 시) + 스토리 업로드 + 뷰어 상태
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<"post" | "story" | null>(null);
  const [storyPosting, setStoryPosting] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [ringRefreshKey, setRingRefreshKey] = useState(0);
  const [viewer, setViewer] = useState<{ uid: string; ring: StoryRingEntryDto[] } | null>(null);
  // 이 프로필 유저의 활성 스토리 유무 - 있으면 아바타가 스토리 진입점(lit 링)이
  // 된다. /api/stories/user/{uid}는 익명 허용이라 비로그인 열람도 가능하다.
  const [hasActiveStories, setHasActiveStories] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    setPostsAuthRequired(false);
    setItems(null);
    listUserPosts(params.id)
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setPostsAuthRequired(true);
        }
        setPosts([]);
      });
    listUserConstellations(params.id)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // 본인이 스토리를 새로 올리면(ringRefreshKey) 아바타 링도 즉시 갱신한다.
  useEffect(() => {
    let cancelled = false;
    setHasActiveStories(false);
    listUserStories(params.id)
      .then((list) => {
        if (!cancelled) setHasActiveStories(list.length > 0);
      })
      .catch(() => {
        // 실패 시 링 없이 두면 그만 - 진입점만 사라질 뿐 열람은 뷰어가 재시도.
      });
    return () => {
      cancelled = true;
    };
  }, [params.id, ringRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setFollowError(null);
    getProfile(params.id)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // 404/에러 시 자리표시 유지.
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const displayName = profile?.displayName ?? "이름 없는 관측자";
  const avatarEmoji = profile?.avatarEmoji ?? "🔭";

  // 비로그인 방문자는 프로필 API가 isFollowing 자체를 안 내려줘 버튼 상태를
  // 알 수 없다 - 그래도 버튼은 보여주고 클릭 시 로그인으로 보낸다(사용자 지시).
  async function handleFollowToggle(): Promise<void> {
    if (!authLoading && !user) {
      router.push(`/login?next=${encodeURIComponent(`/profile/${params.id}`)}`);
      return;
    }
    if (!profile || profile.isFollowing === undefined || followPending) return;
    setFollowPending(true);
    setFollowError(null);
    try {
      const updated = profile.isFollowing
        ? await unfollowUser(params.id)
        : await followUser(params.id);
      setProfile(updated);
    } catch (err) {
      setFollowError(
        err instanceof ApiError && err.status === 429
          ? "요청이 많아요. 잠시 후 다시 시도해주세요."
          : "팔로우 처리에 실패했어요."
      );
    } finally {
      setFollowPending(false);
    }
  }

  async function handleFilesPicked(fileList: FileList | null): Promise<void> {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (uploadTarget === "story") {
      setStoryError(null);
      setStoryPosting(true);
      try {
        const first = files[0];
        if (!first) return;
        const imageData = await fileToDataUrl(first);
        await createStory(imageData);
        setRingRefreshKey((k) => k + 1);
      } catch {
        setStoryError("스토리를 올리지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        setStoryPosting(false);
        setUploadTarget(null);
      }
      return;
    }
    // 사진 게시물: 최대 10장, 선택 순서가 곧 게시 순서(리사이즈는 장별 적용).
    setPostError(files.length > POST_IMAGES_MAX ? `사진은 ${POST_IMAGES_MAX}장까지예요. 앞의 ${POST_IMAGES_MAX}장만 담았어요.` : null);
    try {
      const images: string[] = [];
      for (const file of files.slice(0, POST_IMAGES_MAX)) {
        images.push(await fileToDataUrl(file));
      }
      setDraftPreviewIdx(0);
      setDraft({ images, caption: "" });
    } catch {
      setPostError("이미지를 읽지 못했어요. 다른 파일로 시도해주세요.");
    } finally {
      setUploadTarget(null);
    }
  }

  async function handlePublishPost(): Promise<void> {
    if (!draft || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const created = await createPost({ images: draft.images, caption: draft.caption.trim() });
      setPosts((prev) => [created, ...(prev ?? [])]);
      setDraft(null);
    } catch {
      setPostError("게시물을 올리지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPosting(false);
    }
  }

  const stats: { label: string; value: number | string }[] = [
    { label: "게시물", value: posts?.length ?? "–" },
    { label: "별자리", value: items?.length ?? "–" },
    { label: "팔로워", value: profile?.followerCount ?? "–" },
    { label: "팔로잉", value: profile?.followingCount ?? "–" },
  ];

  return (
    <>
      {/* ─ 헤더 (인스타 해부학: 아바타 | 이름·통계·bio) ─ */}
      <div className="flex items-start gap-5 md:gap-10">
        {/* 아바타 - 활성 스토리가 있으면 lit 링 + 클릭→뷰어(익명 열람 가능),
            없으면 장식 헤어라인 그대로. */}
        {hasActiveStories ? (
          <button
            type="button"
            aria-label={`${displayName}의 스토리 보기`}
            onClick={() =>
              setViewer({
                uid: params.id,
                ring: [{ uid: params.id, displayName, avatarEmoji, hasUnseen: true }],
              })
            }
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-lit bg-ink-800 p-1 transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b md:h-28 md:w-28"
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-ink-900 text-[34px] md:text-[46px]">
              {avatarEmoji}
            </span>
          </button>
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-800 p-1 md:h-28 md:w-28">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-ink-900 text-[34px] md:text-[46px]">
              {avatarEmoji}
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="truncate font-sans text-heading font-semibold text-text-hi">{displayName}</h1>
            {(profile?.isFollowing !== undefined || (!authLoading && !user && !isOwn)) && (
              <Button variant="ghost" size="sm" onClick={handleFollowToggle} disabled={followPending}>
                {profile?.isFollowing ? "팔로잉" : "팔로우"}
              </Button>
            )}
            {/* 향후: 타인 프로필의 "메시지"(DM) 버튼이 이 옆에 선다. */}
            {isOwn && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="프로필 설정 메뉴"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-md p-1.5 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                >
                  <KebabIcon />
                </button>
                {menuOpen && (
                  <>
                    {/* 바깥 클릭으로 닫는 투명 배경 */}
                    <button
                      type="button"
                      aria-label="메뉴 닫기"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-lg border border-rule bg-ink-800/95 shadow-panel backdrop-blur-md">
                      {/* 향후: 프로필 편집, 스토리 설정 등 잡다한 설정 항목이
                          이 메뉴에 쌓인다(사용자 지시). */}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setDeleteOpen(true);
                        }}
                        className="block w-full px-3.5 py-2.5 text-left font-sans text-body-sm text-spec-m transition-colors hover:bg-ink-700"
                      >
                        회원 탈퇴
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-5 md:gap-7">
            {stats.map((s) => (
              <span key={s.label} className="font-sans text-body-sm text-text-lo">
                <b className="mr-1 font-semibold text-text-hi">{s.value}</b>
                {s.label}
              </span>
            ))}
          </div>

          {profile?.bio && (
            <p className="mt-2.5 max-w-md text-body-sm leading-relaxed text-text-lo">{profile.bio}</p>
          )}
          {followError && <p className="mt-1.5 text-micro text-spec-m">{followError}</p>}
        </div>
      </div>

      {/* 스토리 하이라이트 줄 - 헤더와 탭 사이 */}
      <StoryRing
        key={ringRefreshKey}
        onOpen={(uid, ring) => setViewer({ uid, ring })}
        className="mt-6"
      />
      {storyError && <p className="mt-1.5 text-micro text-spec-m">{storyError}</p>}

      {/* ─ 탭 줄 (인스타처럼 상단 보더 + 중앙 아이콘) ─ */}
      <div className="mt-8 flex items-center justify-center gap-14 border-t border-rule">
        {(
          [
            { key: "photos", label: "사진 게시물", Icon: GridIcon },
            { key: "constellations", label: "별자리", Icon: StarTabIcon },
          ] as const
        ).map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-selected={active}
              role="tab"
              onClick={() => setTab(key)}
              className={
                "-mt-px flex items-center gap-1.5 border-t-2 px-1 py-3 font-sans text-caption transition-colors " +
                (active
                  ? "border-text-hi text-text-hi"
                  : "border-transparent text-text-lo hover:text-text-hi")
              }
            >
              <Icon size={16} />
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ─ 그리드 ─ */}
      <div className="mt-1">
        {tab === "photos" ? (
          posts === null ? (
            <GridSkeleton />
          ) : postsAuthRequired ? (
            <EmptyState
              title="게시물은 로그인하고 볼 수 있어요"
              action={
                <Link
                  href={`/login?next=${encodeURIComponent(`/profile/${params.id}`)}`}
                  className="rounded-md border border-transparent bg-spec-b px-5 py-2.5 text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
                >
                  로그인
                </Link>
              }
            />
          ) : posts.length === 0 && !isOwn ? (
            <EmptyState title="아직 게시물이 없어요" />
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {isOwn && (
                <button
                  type="button"
                  onClick={() => setUploadSheetOpen(true)}
                  disabled={storyPosting}
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 border border-dashed border-rule text-text-lo transition-colors hover:bg-ink-800 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" fill="transparent" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span className="font-sans text-micro">{storyPosting ? "스토리 올리는 중…" : "새로 만들기"}</span>
                </button>
              )}
              {posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => setLightbox(post)}
                  className="group relative aspect-square overflow-hidden bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 최적화 대상이 아니다 */}
                  <img
                    src={post.imageData}
                    alt={post.caption || "게시물 사진"}
                    className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.03]"
                  />
                  {(post.imageCount ?? 1) > 1 && (
                    <span className="absolute right-1.5 top-1.5 text-text-hi drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" aria-label="사진 여러 장">
                      <MultiImageIcon />
                    </span>
                  )}
                  {post.caption && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink-900/85 to-transparent px-2 pb-1.5 pt-5 text-left text-caption text-text-hi opacity-0 transition-opacity group-hover:opacity-100">
                      {post.caption}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        ) : items === null ? (
          <GridSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 띄운 별자리가 없어요"
            description={isOwn ? "'별자리 생성하기'에서 첫 별자리를 만들어보세요." : undefined}
            action={
              isOwn ? (
                <Link
                  href="/constellation/new"
                  className="rounded-md border border-transparent bg-spec-b px-5 py-2.5 text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
                >
                  별자리 생성하러 가기
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {items.map((item) => (
              <ConstellationTile key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* 숨은 파일 입력 - 업로드 선택 시트의 "사진 게시물"/"스토리" 항목이 트리거 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />

      {/* 업로드 선택 시트 - "새로 만들기" 타일 클릭 시 등장(기존 케밥 메뉴 관례) */}
      <Modal open={uploadSheetOpen} onClose={() => setUploadSheetOpen(false)} title="새로 만들기" size="sm">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setUploadTarget("post");
              setUploadSheetOpen(false);
              // 상태 반영 전에 click이 나가므로 multiple은 DOM에 직접 세팅한다.
              if (fileInputRef.current) fileInputRef.current.multiple = true;
              fileInputRef.current?.click();
            }}
            className="rounded-md px-3.5 py-3 text-left font-sans text-body-sm text-text-hi transition-colors hover:bg-ink-700"
          >
            사진 게시물
          </button>
          <button
            type="button"
            onClick={() => {
              setUploadTarget("story");
              setUploadSheetOpen(false);
              if (fileInputRef.current) fileInputRef.current.multiple = false;
              fileInputRef.current?.click();
            }}
            className="rounded-md px-3.5 py-3 text-left font-sans text-body-sm text-text-hi transition-colors hover:bg-ink-700"
          >
            스토리
          </button>
          <div className="rounded-md px-3.5 py-3">
            <span className="font-sans text-body-sm text-text-lo/60">영상 — 준비 중</span>
            <p className="mt-0.5 font-sans text-micro text-text-lo/50">저장소 연결 후 제공돼요</p>
          </div>
        </div>
      </Modal>

      {/* 스토리 뷰어 - 링/피드 어디서 열든 동일 컴포넌트 */}
      {viewer && (
        <StoryViewer ring={viewer.ring} startUid={viewer.uid} onClose={() => setViewer(null)} />
      )}

      {/* 새 게시물 컴포저 - 미리보기 + 짤막한 글 */}
      <Modal open={draft !== null} onClose={() => !posting && setDraft(null)} title="새 게시물">
        {draft && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL 미리보기 */}
            <img
              src={draft.images[Math.min(draftPreviewIdx, draft.images.length - 1)]}
              alt="업로드할 사진 미리보기"
              className="max-h-[42vh] w-full rounded-md bg-ink-900 object-contain"
            />
            {/* 순서 미리보기 스트립 - 선택 순서가 곧 게시 순서. ✕로 장별 제외. */}
            {draft.images.length > 1 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto py-1">
                {draft.images.map((img, i) => (
                  <div key={i} className="relative shrink-0">
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 사진 미리보기`}
                      onClick={() => setDraftPreviewIdx(i)}
                      className={
                        "block h-14 w-14 overflow-hidden rounded-md border-2 " +
                        (i === Math.min(draftPreviewIdx, draft.images.length - 1)
                          ? "border-spec-b"
                          : "border-transparent opacity-70 hover:opacity-100")
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL 썸네일 */}
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 사진 빼기`}
                      onClick={() => {
                        const images = draft.images.filter((_, j) => j !== i);
                        if (images.length === 0) {
                          setDraft(null);
                          return;
                        }
                        setDraftPreviewIdx((idx) => Math.min(idx, images.length - 1));
                        setDraft({ ...draft, images });
                      }}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-micro leading-none text-text-hi"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={draft.caption}
              maxLength={CAPTION_MAX}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={2}
              placeholder="짤막한 글을 남겨보세요 (선택)"
              className="mt-3 w-full resize-none rounded-md border border-rule bg-ink-900/70 px-3 py-2 font-sans text-sm text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            />
            {postError && <p className="mt-1.5 text-micro text-spec-m">{postError}</p>}
            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={handlePublishPost} disabled={posting}>
                {posting ? "올리는 중…" : "올리기"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={posting}>
                취소
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* 라이트박스 - "누르면 확대되면서" 보는 인스타 관례. 본문(캐러셀·별
          좋아요·댓글·공유)은 /post/{id} 퍼머링크와 같은 PostDetail 하나다. */}
      <Modal open={lightbox !== null} onClose={() => setLightbox(null)} title={displayName}>
        {lightbox && (
          <PostDetail
            postId={lightbox.id}
            initial={lightbox}
            showDelete={isOwn}
            onDeleted={() => {
              setPosts((prev) => (prev ?? []).filter((p) => p.id !== lightbox.id));
              setLightbox(null);
            }}
            onPostChange={(updated) =>
              setPosts((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)))
            }
          />
        )}
      </Modal>

      <AccountDeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onDeleted={() => router.push("/")} />
    </>
  );
}
