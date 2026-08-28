"use client";

/*
 * 소셜 피드 - 인스타식 게시물 스트림(사용자 지시: "소셜은 인스타처럼 정말
 * 게시물이랑 동영상, 스토리 띄우자"). 별자리 카드 피드는 제거됐다 - 별자리는
 * 프로필의 별자리 탭과 /constellation/{cid} 뷰어가 담당(MiniConstellation은
 * 거기서 계속 쓴다). 사람 발견은 /explore(탐색)로 분리됐다.
 *
 * 로그인 여부에 따른 분기(비로그인 "/"는 TelescopeLanding)는 이 컴포넌트
 * 밖(app/page.tsx)의 책임. GET /api/posts/feed가 익명 허용이라 여기는 로그인
 * 여부를 신경 쓰지 않는다(좋아요만 login?next 유도).
 *
 * 댓글은 카운트+퍼머링크 유도만 - 스트림에서 글마다 상세를 부르면 N+1이라
 * 목록 응답만으로 그린다. 캐러셀·별 좋아요는 PostDetail의 것을 재사용.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { StoryRing } from "@/components/StoryRing";
import { StoryViewer } from "@/components/StoryViewer";
import { LikeStarIcon, PostImageCarousel, ShareIcon, usePostImages } from "@/components/PostDetail";
import { likePost, listFeedPosts, unlikePost, type FeedPostDto } from "@/lib/posts-api";
import type { StoryRingEntryDto } from "@/lib/stories-api";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";

/** 데이터 로딩 중 표시. app/page.tsx가 인증 상태 로딩 중에도 동일한 스켈레톤을
 * 재사용하므로 export한다. */
export function FeedSkeleton() {
  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:px-6">
      <div className="mb-8 h-8 w-32 animate-pulse rounded bg-ink-800" />
      <div className="flex flex-col gap-8">
        {[0, 1].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-rule bg-ink-800/70">
            <div className="h-12 animate-pulse bg-ink-700/40" />
            <div className="aspect-square animate-pulse bg-ink-700/50" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-ink-700/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedPostCard({
  post,
  onPostChange,
}: {
  post: FeedPostDto;
  onPostChange: (updated: FeedPostDto) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [liking, setLiking] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const slides = usePostImages(post.id, post.imageCount ?? 1, post.imageData);

  async function handleLikeToggle(): Promise<void> {
    if (!user) {
      router.push(`/login?next=/feed`);
      return;
    }
    if (liking) return;
    setLiking(true);
    try {
      const updated = post.isLiked ? await unlikePost(post.id) : await likePost(post.id);
      // 작성자 조인 필드는 like 응답에 없으니 기존 값을 보존해 머지한다.
      onPostChange({ ...post, ...updated });
    } catch {
      // 조용히 실패 - 재시도 가능.
    } finally {
      setLiking(false);
    }
  }

  async function handleShare(): Promise<void> {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("링크를 복사했어요");
    } catch {
      setShareNotice(url);
    }
    setTimeout(() => setShareNotice(null), 2500);
  }

  return (
    <article className="overflow-hidden rounded-lg border border-rule bg-ink-800/70 backdrop-blur-[2px]">
      {/* 작성자 줄 */}
      <Link
        href={`/profile/${post.ownerId}`}
        className="flex items-center gap-2.5 px-3.5 py-2.5 no-underline"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-lg">
          {post.ownerAvatarEmoji ?? "🔭"}
        </span>
        <span className="truncate font-sans text-body-sm font-semibold text-text-hi">
          {post.ownerDisplayName ?? "관측자"}
        </span>
        <span className="ml-auto shrink-0 font-sans text-micro text-text-lo">
          {relativeTimeKo(post.createdAt)}
        </span>
      </Link>

      <PostImageCarousel slides={slides} totalCount={post.imageCount ?? 1} alt={post.caption || "게시물 사진"} />

      {/* 액션 줄 + 캡션 + 댓글 유도 */}
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleLikeToggle()}
            disabled={liking}
            aria-label={post.isLiked ? "좋아요 취소" : "좋아요"}
            aria-pressed={post.isLiked === true}
            className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <LikeStarIcon filled={post.isLiked === true} size={20} />
            <span className="font-mono text-body-sm">{post.likeCount ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            aria-label="공유"
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <ShareIcon size={18} />
          </button>
          {shareNotice && <span className="truncate text-caption text-text-lo">{shareNotice}</span>}
        </div>
        {post.caption && (
          <p className="line-clamp-3 whitespace-pre-wrap text-body-sm leading-relaxed text-text-hi">
            {post.caption}
          </p>
        )}
        <Link
          href={`/post/${post.id}`}
          className="self-start font-sans text-caption text-text-lo no-underline hover:text-text-hi"
        >
          {(post.commentCount ?? 0) > 0 ? (
            <>
              댓글 <span className="font-mono">{post.commentCount}</span>개 모두 보기
            </>
          ) : (
            "댓글 남기기"
          )}
        </Link>
      </div>
    </article>
  );
}

/** 아직 게시물이 없을 때 - 점선 시야원 + 속이 빈 별(랜딩 선화 어휘 축약판). */
function EmptyFeedFigure() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto mb-5" aria-hidden>
      <circle cx="60" cy="60" r="46" stroke="var(--rule)" strokeWidth="1" strokeDasharray="3 6" fill="transparent" />
      <g stroke="var(--rule)" fill="transparent" strokeWidth="1.2" opacity="0.7">
        <circle cx="46" cy="52" r="4" />
        <circle cx="76" cy="44" r="3" />
        <circle cx="66" cy="76" r="3.5" />
      </g>
    </svg>
  );
}

/** SNS 피드(스토리 링 + 게시물 스트림). 데이터 fetch까지 포함해 자기완결적. */
export function FeedView() {
  const [posts, setPosts] = useState<FeedPostDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uid: string; ring: StoryRingEntryDto[] } | null>(null);

  function load() {
    setError(null);
    setPosts(null);
    listFeedPosts()
      .then(setPosts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "피드를 불러오지 못했어요"));
  }

  useEffect(load, []);

  if (error) {
    return (
      <div className="mx-auto max-w-sm py-24 text-center">
        <p className="text-body-sm text-text-lo">{error}</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={load}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (posts === null) return <FeedSkeleton />;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:px-6">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">소셜</h1>
        {/* 검수 4·5번: tracking은 한글에 안 얹고, 영어 장식 어구 대신 수 메타만. */}
        <span className="text-caption text-text-lo">
          <span className="font-sans">게시물 </span>
          <span className="font-mono tracking-[0.14em]">{posts.length}</span>
          <span className="font-sans">개</span>
        </span>
      </header>

      <StoryRing onOpen={(uid, ring) => setViewer({ uid, ring })} className="mb-6" />

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule px-6 py-16 text-center">
          <EmptyFeedFigure />
          <p className="text-body font-semibold text-text-lo">아직 게시물이 없어요</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-text-lo/80">
            프로필에서 첫 사진을 올려보세요
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              onPostChange={(updated) =>
                setPosts((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)))
              }
            />
          ))}
          {/* 동영상 자리 - Storage(Blaze) 연결 후 별도 배치(지금은 자리만). */}
          <div className="rounded-lg border border-dashed border-rule px-6 py-8 text-center">
            <span className="font-sans text-body-sm text-text-lo/60">동영상 — 준비 중</span>
            <p className="mt-1 font-sans text-micro text-text-lo/50">저장소 연결 후 제공돼요</p>
          </div>
        </div>
      )}

      {viewer && (
        <StoryViewer ring={viewer.ring} startUid={viewer.uid} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
