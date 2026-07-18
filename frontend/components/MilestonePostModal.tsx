"use client";

import { useEffect, useRef, useState } from "react";
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

const INPUT_CLS =
  "w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]";

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
  const [editing, setEditing] = useState(isOwn && milestone.post === null);
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,10,5,.72)] px-4 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-[rgba(143,220,138,.2)] bg-[rgba(7,22,12,.96)] p-6 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-serif text-[13px] text-moss-600">
              {String(milestone.order_index + 1).padStart(2, "0")} · {milestone.title}
            </div>
            <h2 className="mt-1 font-serif text-[20px] font-bold text-moss-100">
              {editing ? (post ? "기록 수정" : "기록 남기기") : "마일스톤"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2.5 py-1 text-[15px] text-moss-600 transition-colors hover:bg-[rgba(143,220,138,.12)] hover:text-moss-300"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 마일스톤 가이드 — 기록 유무와 무관하게 항상 표시 (무엇을/왜/어떻게 + 완료 기준) */}
        {!editing && (
          <div className="mb-5 rounded-xl border border-[rgba(143,220,138,.14)] bg-[rgba(143,220,138,.05)] p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-moss-600">
              <span className="font-semibold text-moss-500">목표 기한</span>
              <span>~ {milestone.due_date.replace(/-/g, ".")}</span>
              <span className="ml-auto rounded-full bg-[rgba(143,220,138,.12)] px-2 py-0.5 text-moss-400">
                {milestone.status}
              </span>
            </div>
            <p className="whitespace-pre-line text-[13px] leading-[1.8] text-moss-300">
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
                className="max-h-[240px] w-full rounded-xl object-cover"
              />
            )}
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 80))}
              placeholder="짤막한 문구 (80자 이내)"
              className={INPUT_CLS}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="줄글 기록 (선택) — 어떤 과정이었는지, 배운 것, 남기고 싶은 이야기"
              rows={6}
              className={`${INPUT_CLS} resize-none leading-relaxed`}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="text-[12.5px] text-moss-400 file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-[rgba(143,220,138,.28)] file:bg-[rgba(143,220,138,.13)] file:px-4 file:py-2 file:text-[12px] file:font-semibold file:text-bean-100"
            />
            {post?.has_image && (
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-moss-500">
                <input
                  type="checkbox"
                  checked={removeImage}
                  onChange={(e) => setRemoveImage(e.target.checked)}
                  className="accent-bean-500"
                />
                기존 사진 지우기
              </label>
            )}
            {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending || !caption.trim()}
                className="flex-1 rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] transition-colors hover:bg-[#4aa353] disabled:opacity-50"
              >
                {pending ? "저장 중…" : "저장하기"}
              </button>
              {post && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setCaption(post.caption);
                    setBody(post.body ?? "");
                    setRemoveImage(false);
                  }}
                  className="rounded-xl border border-[rgba(143,220,138,.25)] px-4 text-[13px] font-semibold text-moss-400 transition-colors hover:bg-[rgba(143,220,138,.1)]"
                >
                  취소
                </button>
              )}
            </div>
          </div>
        ) : post ? (
          <div className="flex flex-col gap-4">
            {post.has_image && post.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={apiUrl(post.image_url)}
                alt={post.caption}
                className="w-full rounded-xl object-cover"
              />
            )}
            <div>
              <p className="font-serif text-[17px] font-bold leading-relaxed text-moss-50">
                “{post.caption}”
              </p>
              {post.body && (
                <p className="mt-3 whitespace-pre-line text-[13.5px] leading-[1.8] text-moss-400">
                  {post.body}
                </p>
              )}
              <p className="mt-3 text-[11px] text-moss-700">{formatDateKo(post.updated_at)}</p>
            </div>

            <div className="flex items-center gap-3 border-t border-[rgba(143,220,138,.12)] pt-3">
              <button
                type="button"
                onClick={toggleLike}
                disabled={!canInteract || likePending}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-default ${
                  post.liked_by_me
                    ? "border-[rgba(240,232,180,.45)] bg-[rgba(240,232,180,.13)] text-bloom-300"
                    : "border-[rgba(143,220,138,.22)] text-moss-500 hover:bg-[rgba(143,220,138,.1)]"
                }`}
              >
                {post.liked_by_me ? "🌼" : "🤍"} {post.like_count}
              </button>
              <span className="text-[12px] text-moss-600">💬 {post.comment_count}</span>
              {isOwn && (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-[12px] font-semibold text-moss-500 hover:text-moss-300"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={removePost}
                    className="text-[12px] font-semibold text-wither-300 hover:brightness-125"
                  >
                    삭제
                  </button>
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-[15px]">{c.user.avatar_emoji}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[12px] font-semibold text-moss-300">
                      {c.user.display_name}
                    </span>
                    <p className="text-[12.5px] leading-relaxed text-moss-400">{c.content}</p>
                  </div>
                  {c.can_delete && (
                    <button
                      type="button"
                      onClick={() => removeComment(c.id)}
                      className="shrink-0 text-[11px] text-moss-700 hover:text-wither-300"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
              {canInteract && (
                <form onSubmit={submitComment} className="mt-1 flex gap-2">
                  <input
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value.slice(0, 500))}
                    placeholder="응원 한마디 남기기"
                    className={`${INPUT_CLS} !py-2 text-[12.5px]`}
                  />
                  <button
                    type="submit"
                    disabled={pending || !commentInput.trim()}
                    className="shrink-0 rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] px-3.5 text-[12px] font-semibold text-bean-100 transition-colors hover:bg-[rgba(143,220,138,.25)] disabled:opacity-50"
                  >
                    등록
                  </button>
                </form>
              )}
              {error && <p className="text-[12px] text-wither-300">{error}</p>}
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-moss-600">아직 기록이 없어요.</p>
        )}
      </div>
    </div>
  );
}
