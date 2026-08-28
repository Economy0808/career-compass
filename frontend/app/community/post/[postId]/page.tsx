"use client";

/*
 * 글 상세 - 본문 + 좋아요 토글 + 댓글. 비로그인은 열람만 되고, 좋아요/댓글
 * 입력을 누르면 /login?next=현재경로로 유도한다. 댓글의 익명 강제 여부는
 * 글이 속한 boardId로 판정한다(사용자 지시: "글의 boardId로 강제 익명 판정").
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, EmptyState, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";
import {
  addComment,
  getCommunityPost,
  isForcedAnonymousBoard,
  toggleLike,
  type CommunityCommentDto,
  type CommunityPostDetailDto,
} from "@/lib/community-api";

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-8 w-2/3 animate-pulse rounded bg-ink-800" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-ink-800" />
      <div className="mt-4 h-32 animate-pulse rounded-lg bg-ink-800/70" />
    </div>
  );
}

function CommentRow({ comment }: { comment: CommunityCommentDto }) {
  const authorLabel = comment.isAnonymous
    ? comment.isMine
      ? "익명(나)"
      : "익명"
    : (comment.authorName ?? "익명");
  return (
    <div className="rounded-lg border border-rule bg-ink-800/70 p-3.5">
      <div className="flex items-center gap-2 text-caption text-text-lo">
        <span className="font-semibold text-text-hi">{authorLabel}</span>
        <span aria-hidden>·</span>
        <span>{relativeTimeKo(comment.createdAt)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-body-sm text-text-hi">{comment.body}</p>
    </div>
  );
}

export default function CommunityPostPage() {
  const params = useParams<{ postId: string }>();
  const postId = params.postId;
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<CommunityPostDetailDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [liking, setLiking] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPost(null);
    setLoadError(false);
    getCommunityPost(postId)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function handleLike(): Promise<void> {
    if (!post) return;
    if (!user) {
      router.push(`/login?next=/community/post/${postId}`);
      return;
    }
    if (liking) return;
    setLiking(true);
    try {
      const result = await toggleLike(postId);
      setPost((prev) => (prev ? { ...prev, likeCount: result.likeCount } : prev));
    } catch {
      // 조용히 실패 - 카운트는 그대로 두고 재시도 가능.
    } finally {
      setLiking(false);
    }
  }

  async function handleAddComment(): Promise<void> {
    if (!post) return;
    if (!user) {
      router.push(`/login?next=/community/post/${postId}`);
      return;
    }
    if (!commentBody.trim() || submittingComment) return;
    setSubmittingComment(true);
    setCommentError(null);
    try {
      const forcedAnonymous = isForcedAnonymousBoard(post.boardId);
      const created = await addComment(postId, {
        body: commentBody.trim(),
        isAnonymous: forcedAnonymous ? true : commentAnonymous,
      });
      setPost((prev) => (prev ? { ...prev, comments: [...prev.comments, created] } : prev));
      setCommentBody("");
    } catch {
      setCommentError("댓글을 올리지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmittingComment(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <EmptyState title="글을 불러오지 못했어요" description="삭제되었거나 잠시 문제가 있어요" />
      </div>
    );
  }

  if (post === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <DetailSkeleton />
      </div>
    );
  }

  const forcedAnonymous = isForcedAnonymousBoard(post.boardId);
  const authorLabel = post.isAnonymous ? (post.isMine ? "익명(나)" : "익명") : (post.authorName ?? "익명");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">{post.title}</h1>
        <div className="flex items-center gap-2 text-caption text-text-lo">
          <span className="font-semibold text-text-hi">{authorLabel}</span>
          <span aria-hidden>·</span>
          <span>{relativeTimeKo(post.createdAt)}</span>
        </div>
      </header>

      <p className="mt-5 whitespace-pre-wrap text-body leading-relaxed text-text-hi">{post.body}</p>

      <div className="mt-5 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={handleLike} disabled={liking}>
          좋아요 {post.likeCount}
        </Button>
        <span className="font-mono text-caption text-text-lo">댓글 {post.comments.length}</span>
      </div>

      <div className="mt-8 flex flex-col gap-2.5">
        {post.comments.length === 0 ? (
          <EmptyState title="아직 댓글이 없어요" description="첫 댓글을 남겨보세요" />
        ) : (
          post.comments.map((c) => <CommentRow key={c.id} comment={c} />)
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-rule pt-6">
        <Field
          id="comment-body"
          label="댓글 작성"
          multiline
          rows={3}
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          maxLength={1000}
          placeholder={user ? "댓글을 남겨보세요" : "로그인하면 댓글을 남길 수 있어요"}
        />
        {forcedAnonymous ? (
          <p className="text-caption text-text-lo">이 게시판은 익명만 가능해요</p>
        ) : (
          <label className="flex items-center gap-2 text-body-sm text-text-lo">
            <input
              type="checkbox"
              checked={commentAnonymous}
              onChange={(e) => setCommentAnonymous(e.target.checked)}
              className="h-4 w-4 rounded-sm border-rule accent-spec-b"
            />
            익명으로 작성
          </label>
        )}
        {commentError && <p className="text-micro text-spec-m">{commentError}</p>}
        <Button onClick={handleAddComment} disabled={submittingComment || !commentBody.trim()} className="self-start">
          {submittingComment ? "올리는 중…" : "댓글 남기기"}
        </Button>
      </div>
    </div>
  );
}
