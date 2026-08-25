"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Chip, EmptyState, Field, Modal } from "@/components/ui";
import {
  ApiError,
  apiUrl,
  deleteComment,
  deleteMilestonePost,
  getComments,
  likePost,
  postComment,
  putMilestonePost,
  unlikePost,
} from "@/lib/api";
import { formatDateKo } from "@/lib/format";
import type { CommentOut, MilestoneOut, MilestonePostOut } from "@/lib/types";

interface MilestonePostModalProps {
  milestone: MilestoneOut;
  isOwn: boolean;
  /** 좋아요/댓글 가능 여부 (연세 인증 로그인 유저) */
  canInteract: boolean;
  onClose: () => void;
  /** 저장/삭제 후 부모 상태 갱신 (null = 기록 삭제됨) */
  onChanged: (post: MilestonePostOut | null) => void;
}

export function MilestonePostModal({
  milestone,
  isOwn,
  canInteract,
  onClose,
  onChanged,
}: MilestonePostModalProps) {
  const [post, setPost] = useState<MilestonePostOut | null>(milestone.post);
  // 항상 가이드(자세히 보기)가 먼저 보이도록 열람 모드로 시작 — 기록 작성은 버튼으로 진입
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(milestone.post?.caption ?? "");
  const [body, setBody] = useState(milestone.post?.body ?? "");
  const [removeImage, setRemoveImage] = useState(false);
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [pending, setPending] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (milestone.post === null) return;
    let cancelled = false;
    getComments(milestone.id)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [milestone.id, milestone.post]);

  async function save() {
    if (!caption.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const saved = await putMilestonePost(milestone.id, {
        caption: caption.trim(),
        body: body.trim(),
        file: fileRef.current?.files?.[0] ?? null,
        removeImage,
      });
      setPost(saved);
      onChanged(saved);
      setEditing(false);
      setRemoveImage(false);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "저장에 실패했어요.");
    } finally {
      setPending(false);
    }
  }

  async function removePost() {
    if (pending) return;
    setPending(true);
    try {
      await deleteMilestonePost(milestone.id);
      onChanged(null);
      onClose();
    } catch {
      setError("삭제에 실패했어요.");
      setPending(false);
    }
  }

  async function toggleLike() {
    if (!post || !canInteract || likePending) return;
    setLikePending(true);
    const next = !post.liked_by_me;
    // 낙관적 업데이트
    const optimistic = {
      ...post,
      liked_by_me: next,
      like_count: post.like_count + (next ? 1 : -1),
    };
    setPost(optimistic);
    onChanged(optimistic);
    try {
      if (next) await likePost(milestone.id);
      else await unlikePost(milestone.id);
    } catch {
      setPost(post);
      onChanged(post);
    } finally {
      setLikePending(false);
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const content = commentInput.trim();
    if (!content || !post || pending) return;
    setPending(true);
    try {
      const created = await postComment(milestone.id, content);
      setComments((prev) => [...prev, created]);
      setCommentInput("");
      const updated = { ...post, comment_count: post.comment_count + 1 };
      setPost(updated);
      onChanged(updated);
    } catch {
      setError("댓글 작성에 실패했어요.");
    } finally {
      setPending(false);
    }
  }

  async function removeComment(commentId: number) {
    try {
      await deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (post) {
        const updated = { ...post, comment_count: Math.max(0, post.comment_count - 1) };
        setPost(updated);
        onChanged(updated);
      }
    } catch {
      setError("댓글 삭제에 실패했어요.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? (post ? "기록 수정" : "기록 남기기") : "마일스톤"}
      size="md"
    >
      <div className="mb-4 font-serif text-body-sm text-content-muted">
        {String(milestone.order_index + 1).padStart(2, "0")} · {milestone.title}
      </div>

      {/* 마일스톤 가이드 — 기록 유무와 무관하게 항상 표시 (무엇을/왜/어떻게 + 완료 기준) */}
      {!editing && (
        <div className="mb-5 rounded-lg border border-line bg-white/6 p-4">
          <div className="mb-2 flex items-center gap-2 text-micro text-content-muted">
            <span className="font-semibold text-content-secondary">목표 기한</span>
            <span>~ {milestone.due_date.replace(/-/g, ".")}</span>
            <span className="ml-auto rounded-full bg-white/8 px-2 py-0.5 text-content-secondary">
              {milestone.status}
            </span>
          </div>
          <p className="whitespace-pre-line text-body-sm leading-[1.8] text-content-secondary">
            {milestone.detail || milestone.description}
          </p>
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-3">
          {post?.has_image && !removeImage && post.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={apiUrl(post.image_url)}
              alt="기록 사진"
              className="max-h-[240px] w-full rounded-lg object-cover"
            />
          )}
          <Field
            id="post-caption"
            label="문구"
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 80))}
            placeholder="짤막한 문구 (80자 이내)"
          />
          <Field
            id="post-body"
            label="줄글 기록 (선택)"
            multiline
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="어떤 과정이었는지, 배운 것, 남기고 싶은 이야기"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="사진 첨부"
            className="text-caption text-content-secondary file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-line-strong file:bg-goal/12 file:px-4 file:py-2 file:text-caption file:font-semibold file:text-goal-bright"
          />
          {post?.has_image && (
            <label className="flex cursor-pointer items-center gap-2 text-caption text-content-secondary">
              <input
                type="checkbox"
                checked={removeImage}
                onChange={(e) => setRemoveImage(e.target.checked)}
                className="accent-growth"
              />
              기존 사진 지우기
            </label>
          )}
          {error && <p className="text-caption text-wither">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending || !caption.trim()} className="flex-1">
              {pending ? "저장 중…" : "저장하기"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setCaption(post?.caption ?? "");
                setBody(post?.body ?? "");
                setRemoveImage(false);
              }}
            >
              취소
            </Button>
          </div>
        </div>
      ) : post ? (
        <div className="flex flex-col gap-4">
          {post.has_image && post.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={apiUrl(post.image_url)}
              alt={post.caption}
              className="w-full rounded-lg object-cover"
            />
          )}
          <div>
            <p className="break-words font-serif text-heading font-bold leading-relaxed text-content-primary">
              “{post.caption}”
            </p>
            {post.body && (
              <p className="mt-3 whitespace-pre-line break-words text-body-sm leading-[1.8] text-content-secondary">
                {post.body}
              </p>
            )}
            <p className="mt-3 text-micro text-content-muted">{formatDateKo(post.updated_at)}</p>
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-3">
            {/* 🌼/🤍는 서비스의 반응 표식이라 아이콘으로 대체하지 않는다. */}
            <Chip
              tone="bloom"
              size="sm"
              interactive
              selected={post.liked_by_me}
              disabled={!canInteract || likePending}
              onClick={() => void toggleLike()}
            >
              {post.liked_by_me ? "🌼" : "🤍"} {post.like_count}
            </Chip>
            <span className="text-caption text-content-muted">💬 {post.comment_count}</span>
            {isOwn && (
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  수정
                </Button>
                <Button size="sm" variant="danger" onClick={removePost}>
                  삭제
                </Button>
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {comments.map((c) => (
              <div key={c.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 text-body">{c.user.avatar_emoji}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-caption font-semibold text-content-secondary">
                    {c.user.display_name}
                  </span>
                  <p className="break-words text-caption leading-relaxed text-content-secondary">
                    {c.content}
                  </p>
                </div>
                {c.can_delete && (
                  <button
                    type="button"
                    onClick={() => removeComment(c.id)}
                    className="shrink-0 text-micro text-content-muted transition-colors hover:text-wither"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
            {canInteract && (
              <form onSubmit={submitComment} className="mt-1 flex items-end gap-2">
                <Field
                  id="post-comment"
                  label="응원 한마디"
                  className="flex-1"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value.slice(0, 500))}
                  placeholder="응원 한마디 남기기"
                />
                <Button type="submit" disabled={pending || !commentInput.trim()}>
                  등록
                </Button>
              </form>
            )}
            {error && <p className="text-caption text-wither">{error}</p>}
          </div>
        </div>
      ) : isOwn ? (
        <Button fullWidth onClick={() => setEditing(true)}>
          기록 남기기
        </Button>
      ) : (
        <EmptyState title="아직 기록이 없어요." />
      )}
    </Modal>
  );
}
