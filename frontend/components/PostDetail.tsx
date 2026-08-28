"use client";

/*
 * 게시물 확대 뷰 본문 - 프로필 라이트박스(모달 내부)와 /post/{postId} 퍼머링크
 * 페이지가 같이 쓰는 단일 컴포넌트(사용자 배치: "사진 여러장 + 좋아요(노란색
 * 별모양) + 댓글 + 공유").
 *
 * - 캐러셀: 목록이 들고 온 대표 썸네일(initial.imageData)을 즉시 보여주고,
 *   imageCount>1일 때만 GET /api/posts/{id}/images를 지연 로드한다.
 * - 좋아요: 별 모양·lit 노랑(달성 별 어휘, DESIGN.md Tertiary). 채움=내가 누름.
 *   비로그인 클릭은 /login?next=퍼머링크로 유도한다.
 * - 댓글: SNS층은 실명 기반(익명 없음). 이름 부재 폴백은 "관측자"(검수 관례).
 * - 공유: navigator.share → 미지원/거부 시 클립보드 복사+안내 폴백.
 * - 상세(getPost)가 아직 없거나 실패해도 initial이 있으면 화면은 살아있어야
 *   한다(백엔드 P1~P3 랜드 전 갭 방어) - 댓글 영역만 조용히 접는다.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, EmptyState, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  addPostComment,
  deletePost,
  getPost,
  likePost,
  listPostImages,
  unlikePost,
  type PostCommentDto,
  type PostDto,
} from "@/lib/posts-api";

const COMMENT_MAX = 500;

/** 5점 별 - 좋아요 아이콘. filled=내가 누름(lit 채움), 아니면 윤곽선만.
 * FeedView의 피드 카드도 같은 별을 쓴다(단일 소유). */
export function LikeStarIcon({ filled, size = 22 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "var(--lit)" : "transparent"}
      stroke={filled ? "var(--lit)" : "currentColor"}
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.4 L17.9 21 L12 17.6 L6.1 21 L7.6 14.4 L2.5 9.9 L9.3 9.2 Z" />
    </svg>
  );
}

export function ShareIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="transparent"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 14 L21 3 M21 3 L14.5 21 L11.5 12.5 L3 9.5 Z" />
    </svg>
  );
}

/** 다중 장 지연 로드 훅 - 목록의 대표 썸네일로 시작해, imageCount>1일 때만
 * 전체 이미지를 불러온다. 실패해도 썸네일 1장으로 살아있는다.
 * PostDetail과 FeedView 피드 카드가 공유한다. */
export function usePostImages(postId: string, imageCount: number, thumbnail: string): string[] {
  const [images, setImages] = useState<string[] | null>(null);
  useEffect(() => {
    if (imageCount <= 1) return;
    let cancelled = false;
    listPostImages(postId)
      .then((list) => {
        if (!cancelled && list.length > 0) setImages(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [postId, imageCount]);
  return images ?? [thumbnail];
}

/** 캐러셀 - 좌우 넘김 + 점 인디케이터 + 지연 로드 전 장수 배지. */
export function PostImageCarousel({
  slides,
  totalCount,
  alt,
}: {
  slides: string[];
  totalCount: number;
  alt: string;
}) {
  const [index, setIndex] = useState(0);
  const current = slides[Math.min(index, slides.length - 1)];

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 최적화 대상이 아니다 */}
      <img src={current} alt={alt} className="max-h-[56vh] w-full rounded-md bg-ink-900 object-contain" />
      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="이전 사진"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-ink-900/70 p-1.5 text-text-hi backdrop-blur-sm transition-opacity disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M15 5 L8 12 L15 19" /></svg>
          </button>
          <button
            type="button"
            aria-label="다음 사진"
            onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
            disabled={index >= slides.length - 1}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-ink-900/70 p-1.5 text-text-hi backdrop-blur-sm transition-opacity disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 5 L16 12 L9 19" /></svg>
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
            {slides.map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 w-1.5 rounded-full transition-colors " +
                  (i === index ? "bg-text-hi" : "bg-text-lo/40")
                }
              />
            ))}
          </div>
        </>
      )}
      {/* 지연 로드 전(다중 장인데 slides가 아직 1장): 장수 배지만 */}
      {slides.length === 1 && totalCount > 1 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-ink-900/70 px-2 py-0.5 font-mono text-micro text-text-lo backdrop-blur-sm">
          1/{totalCount}
        </span>
      )}
    </div>
  );
}

export interface PostDetailProps {
  postId: string;
  /** 목록/그리드가 이미 들고 있는 글 - 상세 fetch 전 즉시 렌더용. */
  initial?: PostDto;
  /** 소유자용 삭제 버튼 노출 여부. */
  showDelete?: boolean;
  /** 삭제 완료 시(모달 닫기·목록 제거는 호출부 몫). */
  onDeleted?: () => void;
  /** 좋아요/댓글 수가 바뀔 때 목록 쪽 카운트 동기화용. */
  onPostChange?: (post: PostDto) => void;
}

export function PostDetail({ postId, initial, showDelete, onDeleted, onPostChange }: PostDetailProps) {
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<PostDto | undefined>(initial);
  const [comments, setComments] = useState<PostCommentDto[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [liking, setLiking] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const permalink = `/post/${postId}`;

  useEffect(() => {
    let cancelled = false;
    getPost(postId)
      .then((detail) => {
        if (cancelled) return;
        const { comments: list, ...p } = detail;
        setPost(p);
        setComments(list);
        onPostChange?.(p);
      })
      .catch((err) => {
        if (cancelled) return;
        // initial 없이 404면 진짜 없는 글. initial이 있으면(라이트박스 경로)
        // 썸네일 기반으로 화면을 유지하고 댓글 영역만 접는다.
        if (!initial && err instanceof ApiError && err.status === 404) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial/onPostChange는 식별용 아님
  }, [postId]);

  const imageCount = post?.imageCount ?? 1;
  const slides = usePostImages(postId, imageCount, post?.imageData ?? "");

  if (notFound) {
    return <EmptyState title="게시물을 찾을 수 없어요" description="삭제되었거나 잘못된 링크예요" />;
  }
  if (!post) {
    return <div className="h-64 animate-pulse rounded-md bg-ink-800/70" aria-hidden />;
  }

  async function handleLikeToggle(): Promise<void> {
    if (!post) return;
    if (!user) {
      router.push(`/login?next=${permalink}`);
      return;
    }
    if (liking) return;
    setLiking(true);
    try {
      const updated = post.isLiked ? await unlikePost(postId) : await likePost(postId);
      setPost(updated);
      onPostChange?.(updated);
    } catch {
      // 조용히 실패 - 재시도 가능.
    } finally {
      setLiking(false);
    }
  }

  async function handleShare(): Promise<void> {
    const url = `${window.location.origin}${permalink}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      // 사용자가 공유 시트를 닫은 경우 등 - 폴백으로 내려가지 않고 조용히 종료.
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

  async function handleAddComment(): Promise<void> {
    if (!user) {
      router.push(`/login?next=${permalink}`);
      return;
    }
    if (!commentBody.trim() || submitting) return;
    setSubmitting(true);
    setCommentError(null);
    try {
      const created = await addPostComment(postId, commentBody.trim());
      setComments((prev) => [...(prev ?? []), created]);
      setPost((prev) => {
        if (!prev) return prev;
        const next = { ...prev, commentCount: prev.commentCount + 1 };
        onPostChange?.(next);
        return next;
      });
      setCommentBody("");
    } catch {
      setCommentError("댓글을 올리지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleteError(false);
    try {
      await deletePost(postId);
      onDeleted?.();
    } catch {
      setDeleteError(true);
    }
  }

  return (
    <div className="flex flex-col">
      {/* ─ 캐러셀 (피드 카드와 공유) ─ */}
      <PostImageCarousel slides={slides} totalCount={imageCount} alt={post.caption || "게시물 사진"} />

      {/* ─ 액션 줄: 별 좋아요 · 공유 · (소유자) 삭제 ─ */}
      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void handleLikeToggle()}
          disabled={liking}
          aria-label={post.isLiked ? "좋아요 취소" : "좋아요"}
          aria-pressed={post.isLiked === true}
          className="flex items-center gap-1.5 rounded-md p-1.5 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        >
          <LikeStarIcon filled={post.isLiked === true} />
          <span className="font-mono text-body-sm">{post.likeCount ?? 0}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleShare()}
          aria-label="공유"
          className="rounded-md p-1.5 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        >
          <ShareIcon />
        </button>
        {shareNotice && <span className="truncate text-caption text-text-lo">{shareNotice}</span>}
        <span className="ml-auto font-mono text-micro text-text-lo">
          {new Date(post.createdAt).toLocaleDateString("ko-KR")}
        </span>
        {showDelete && (
          <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
            삭제
          </Button>
        )}
      </div>
      {deleteError && <p className="mt-1 text-micro text-spec-m">삭제하지 못했어요. 다시 시도해주세요.</p>}

      {post.caption && (
        <p className="mt-2 whitespace-pre-wrap text-body-sm leading-relaxed text-text-hi">{post.caption}</p>
      )}

      {/* ─ 댓글 - 상세 로드 실패 시(백엔드 랜드 전 갭) 영역 자체를 접는다 ─ */}
      {comments !== null && (
        <div className="mt-4 flex flex-col gap-2.5 border-t border-rule pt-4">
          {comments.length === 0 ? (
            <p className="text-caption text-text-lo">아직 댓글이 없어요</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-body-sm leading-relaxed">
                <span className="mr-1.5 font-semibold text-text-hi">{c.authorDisplayName ?? "관측자"}</span>
                <span className="whitespace-pre-wrap text-text-hi">{c.body}</span>
                <span className="ml-1.5 text-micro text-text-lo">{relativeTimeKo(c.createdAt)}</span>
              </div>
            ))
          )}
          <div className="mt-1 flex flex-col gap-2">
            <Field
              id={`post-comment-${postId}`}
              label="댓글 작성"
              multiline
              rows={2}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              maxLength={COMMENT_MAX}
              placeholder={user ? "댓글을 남겨보세요" : "로그인하면 댓글을 남길 수 있어요"}
            />
            {commentError && <p className="text-micro text-spec-m">{commentError}</p>}
            <Button
              size="sm"
              onClick={() => void handleAddComment()}
              disabled={submitting || !commentBody.trim()}
              className="self-start"
            >
              {submitting ? "올리는 중…" : "댓글 남기기"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
