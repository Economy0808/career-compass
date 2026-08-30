"use client";

/*
 * 소셜 데모 - components/FeedView.tsx의 카드 구조(작성자 줄 + 사진 + 별
 * 좋아요 + 공유 + 캡션 + 댓글 유도 + 스토리 링 + 우측 추천 사이드바)를
 * 동일하게 재현하되, 사진은 외부 파일 없이 CSS 그라데이션 + 이모지로
 * 대신한다. 좋아요·팔로우·댓글은 로컬 state 토글/추가만(저장 안 됨).
 * 서버 호출 0(핵심 제약) - components/PostDetail.tsx 등 실제 API를 태우는
 * 컴포넌트는 import하지 않고 마크업만 손으로 복제한다.
 */

import { useState } from "react";
import {
  DEMO_INITIAL_COMMENTS,
  DEMO_POSTS,
  DEMO_STORY_RING,
  DEMO_USERS,
  demoCommonTags,
  type DemoComment,
  type DemoPost,
} from "@/lib/demo-fixtures";
import { Button } from "@/components/ui";
import { SignupPrompt } from "../SignupPrompt";

const SIDEBAR_LIMIT = 6;

function userFor(uid: string) {
  return DEMO_USERS.find((u) => u.uid === uid);
}

/** 좋아요 별 - components/PostDetail.tsx의 LikeStarIcon과 동일한 별 모양(복제,
 * import는 하지 않는다 - 그 파일은 실제 API 호출을 태우는 컴포넌트까지 같이 있다). */
function LikeStarIcon({ filled, size = 20 }: { filled: boolean; size?: number }) {
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

function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M8.3 10.8 L15.7 7.2 M8.3 13.2 L15.7 16.8" strokeLinecap="round" />
    </svg>
  );
}

interface PostState {
  liked: boolean;
  likeCount: number;
  comments: DemoComment[];
}

function DemoPostCard({
  post,
  state,
  onToggleLike,
  onAddComment,
}: {
  post: DemoPost;
  state: PostState;
  onToggleLike: () => void;
  onAddComment: (body: string) => void;
}) {
  const owner = userFor(post.ownerUid);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");

  function handleShare() {
    setShareNotice("둘러보기 모드에서는 공유할 수 없어요");
    setTimeout(() => setShareNotice(null), 2500);
  }

  function submitComment() {
    const body = draft.trim();
    if (!body) return;
    onAddComment(body);
    setDraft("");
  }

  return (
    <article className="overflow-hidden rounded-lg border border-rule bg-ink-800/70 backdrop-blur-[2px]">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-lg">
          {owner?.avatarEmoji ?? "🔭"}
        </span>
        <span className="truncate font-sans text-body-sm font-semibold text-text-hi">
          {owner?.displayName ?? "관측자"}
        </span>
        <span className="ml-auto shrink-0 font-sans text-micro text-text-lo">{post.createdAtLabel}</span>
      </div>

      {/* 사진 자리 - 외부 파일 없이 그라데이션 + 이모지(핵심 제약: 이미지 파일 0개). */}
      <div
        className="flex aspect-square items-center justify-center text-[64px]"
        style={{ background: post.gradient }}
        role="img"
        aria-label={post.caption}
      >
        <span aria-hidden>{post.emoji}</span>
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleLike}
            aria-label={state.liked ? "좋아요 취소" : "좋아요"}
            aria-pressed={state.liked}
            className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <LikeStarIcon filled={state.liked} />
            <span className="font-mono text-body-sm">{state.likeCount}</span>
          </button>
          <button
            type="button"
            onClick={handleShare}
            aria-label="공유"
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <ShareIcon />
          </button>
          {shareNotice && <span className="truncate text-caption text-text-lo">{shareNotice}</span>}
        </div>

        <p className="line-clamp-3 whitespace-pre-wrap text-body-sm leading-relaxed text-text-hi">{post.caption}</p>

        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          className="self-start font-sans text-caption text-text-lo transition-colors hover:text-text-hi"
        >
          {state.comments.length > 0 ? (
            <>
              댓글 <span className="font-mono">{state.comments.length}</span>개 모두 보기
            </>
          ) : (
            "댓글 남기기"
          )}
        </button>

        {showComments && (
          <div className="mt-1 flex flex-col gap-2 border-t border-rule pt-2.5">
            {state.comments.map((c) => {
              const author = userFor(c.authorUid);
              return (
                <p key={c.id} className="text-caption text-text-hi">
                  <span className="font-semibold">{author?.displayName ?? "관측자"}</span>{" "}
                  <span className="text-text-lo">{c.body}</span>
                </p>
              );
            })}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitComment();
                }}
                placeholder="댓글 달기…"
                maxLength={200}
                aria-label="댓글 입력"
                className="min-h-11 flex-1 rounded-md border border-rule bg-ink-900 px-3 text-body-sm text-text-hi placeholder:text-text-lo focus:border-spec-b focus:outline-none"
              />
              <Button variant="ghost" size="sm" onClick={submitComment}>
                게시
              </Button>
            </div>
            <p className="text-micro text-text-lo">둘러보기 모드라 댓글은 저장되지 않아요</p>
          </div>
        )}
      </div>
    </article>
  );
}

function SimilarPeopleSidebar({
  followingUids,
  onToggleFollow,
}: {
  followingUids: Set<string>;
  onToggleFollow: (uid: string) => void;
}) {
  const users = DEMO_USERS.slice(0, SIDEBAR_LIMIT);
  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-3 md:flex">
      <h2 className="font-sans text-caption font-semibold text-text-lo">비슷한 사람 추천</h2>
      {users.map((u) => {
        const common = demoCommonTags(u);
        return (
          <div
            key={u.uid}
            className="flex items-center gap-2.5 rounded-lg border border-rule bg-ink-800/70 px-3 py-2.5 backdrop-blur-[2px]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-900 text-base">
              {u.avatarEmoji}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-sans text-body-sm font-semibold text-text-hi">{u.displayName}</span>
              {common.length > 0 && <span className="truncate font-sans text-micro text-lit">{common[0]}</span>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => onToggleFollow(u.uid)} className="shrink-0">
              {followingUids.has(u.uid) ? "팔로잉" : "팔로우"}
            </Button>
          </div>
        );
      })}
    </aside>
  );
}

export default function DemoSocialPage() {
  const [postStates, setPostStates] = useState<Record<string, PostState>>(() =>
    Object.fromEntries(
      DEMO_POSTS.map((p) => [
        p.id,
        { liked: false, likeCount: p.likeCount, comments: [...(DEMO_INITIAL_COMMENTS[p.id] ?? [])] },
      ])
    )
  );
  const [followingUids, setFollowingUids] = useState<Set<string>>(new Set());
  const [promptOpen, setPromptOpen] = useState(false);

  function toggleLike(postId: string) {
    setPostStates((prev) => {
      const cur = prev[postId];
      if (!cur) return prev;
      const liked = !cur.liked;
      return { ...prev, [postId]: { ...cur, liked, likeCount: cur.likeCount + (liked ? 1 : -1) } };
    });
  }

  function addComment(postId: string, body: string) {
    setPostStates((prev) => {
      const cur = prev[postId];
      if (!cur) return prev;
      const comment: DemoComment = { id: `local-${Date.now()}`, authorUid: "demo-self", body };
      return { ...prev, [postId]: { ...cur, comments: [...cur.comments, comment] } };
    });
  }

  function toggleFollow(uid: string) {
    setFollowingUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  return (
    <div className="flex justify-center gap-8">
      <div className="w-full max-w-lg">
        <header className="mb-6 flex flex-col gap-1.5">
          <h1 className="font-serif text-display font-bold text-text-hi">소셜</h1>
          <span className="text-caption text-text-lo">
            <span className="font-sans">게시물 </span>
            <span className="font-mono tracking-[0.14em]">{DEMO_POSTS.length}</span>
            <span className="font-sans">개</span>
          </span>
        </header>

        {/* 스토리 링 - 실제 화면은 GET /api/stories/ring을 부르지만, 데모는 서버
            호출이 없으므로 클릭하면 가입 유도로만 연결한다(판단 지점 - 보고 참고). */}
        <div className="mb-6 flex gap-4 overflow-x-auto px-1 py-2">
          {DEMO_STORY_RING.map((entry) => (
            <button
              key={entry.uid}
              type="button"
              onClick={() => setPromptOpen(true)}
              className="flex w-16 shrink-0 flex-col items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            >
              <span
                className={
                  "flex h-14 w-14 items-center justify-center rounded-full border-2 bg-ink-800 text-[26px] " +
                  (entry.hasUnseen ? "border-lit" : "border-rule")
                }
              >
                {entry.avatarEmoji}
              </span>
              <span className="w-full truncate text-center font-sans text-micro text-text-lo">
                {entry.displayName}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-8">
          {DEMO_POSTS.map((post) => (
            <DemoPostCard
              key={post.id}
              post={post}
              state={postStates[post.id]}
              onToggleLike={() => toggleLike(post.id)}
              onAddComment={(body) => addComment(post.id, body)}
            />
          ))}
        </div>
      </div>

      <SimilarPeopleSidebar followingUids={followingUids} onToggleFollow={toggleFollow} />

      <SignupPrompt open={promptOpen} onClose={() => setPromptOpen(false)} action="스토리 열람" />
    </div>
  );
}
