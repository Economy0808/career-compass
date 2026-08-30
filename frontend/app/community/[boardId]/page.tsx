"use client";

/*
 * 게시판 글 목록(최신순). 글쓰기는 인증 필수 - 비로그인이 누르면
 * /login?next=현재경로로 보낸다(app/login/page.tsx의 안전 리다이렉트 관례,
 * lib/api.ts:request()는 세션 쿠키만 보고 서버가 401을 판단하므로 여기서는
 * useAuth().user 유무로 미리 막아 헛 API 호출을 줄인다).
 *
 * 비밀 게시판(forcedAnonymous)은 작성 모달에 익명 체크박스 자체가 없다 -
 * "이 게시판은 익명만 가능해요" 한 줄만 보여준다(사용자 지시).
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, EmptyState, Field, Modal } from "@/components/ui";
import { CommunityNoteComposer, NoteKebabMenu, type NoteTarget } from "@/components/CommunityNoteComposer";
import { VerifyGate, isVerifyRequiredError } from "@/components/VerifyGate";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";
import {
  BOARDS,
  createBoardPost,
  isForcedAnonymousBoard,
  listBoardPosts,
  type CommunityPostDto,
} from "@/lib/community-api";

function PostSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-[68px] animate-pulse rounded-lg border border-rule bg-ink-800/70" />
      ))}
    </div>
  );
}

function PostRow({ post, onSendNote }: { post: CommunityPostDto; onSendNote: (post: CommunityPostDto) => void }) {
  // 실명 글인데 프로필 이름이 비어 있으면 "익명"으로 둔갑시키지 말고 중립 폴백.
  const authorLabel = post.isAnonymous ? (post.isMine ? "익명(나)" : "익명") : (post.authorDisplayName ?? "관측자");
  return (
    <div className="flex items-start gap-1 rounded-lg border border-rule bg-ink-800/70 p-4 backdrop-blur-[2px] transition-colors hover:bg-ink-800/90">
      <Link href={`/community/post/${post.id}`} className="block min-w-0 flex-1 no-underline">
        <h3 className="truncate font-sans text-body font-medium text-text-hi">{post.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-text-lo">
          <span>{authorLabel}</span>
          <span aria-hidden>·</span>
          <span>{relativeTimeKo(post.createdAt)}</span>
          <span aria-hidden>·</span>
          {/* No-Korean-Mono: mono는 숫자에만 - 한글 글리프가 없다(DESIGN.md Don't). */}
          <span>
            좋아요 <span className="font-mono">{post.likeCount}</span>
          </span>
          <span aria-hidden>·</span>
          <span>
            댓글 <span className="font-mono">{post.commentCount}</span>
          </span>
        </div>
      </Link>
      {/* 본인 글에는 쪽지 항목을 아예 안 보여준다(isMine 판정, 사용자 지시). */}
      {!post.isMine && <NoteKebabMenu ariaLabel="글 메뉴" onSendNote={() => onSendNote(post)} />}
    </div>
  );
}

export default function CommunityBoardPage() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;
  const router = useRouter();
  const { user } = useAuth();

  const boardMeta = BOARDS.find((b) => b.id === boardId);
  const forcedAnonymous = isForcedAnonymousBoard(boardId);

  const [posts, setPosts] = useState<CommunityPostDto[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);

  function load() {
    setPosts(null);
    listBoardPosts(boardId)
      .then(setPosts)
      .catch(() => setPosts([]));
  }

  useEffect(load, [boardId]);

  function openComposer() {
    if (!user) {
      router.push(`/login?next=/community/${boardId}`);
      return;
    }
    if (!user.yonseiVerified) {
      setVerifyGateOpen(true);
      return;
    }
    setTitle("");
    setBody("");
    setAnonymous(true);
    setError(null);
    setComposerOpen(true);
  }

  async function handleSubmit(): Promise<void> {
    if (!title.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createBoardPost(boardId, {
        title: title.trim(),
        body: body.trim(),
        isAnonymous: forcedAnonymous ? true : anonymous,
      });
      setPosts((prev) => [created, ...(prev ?? [])]);
      setComposerOpen(false);
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setComposerOpen(false);
        setVerifyGateOpen(true);
      } else {
        setError("글을 올리지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openNoteComposer(target: NoteTarget): void {
    if (!user) {
      router.push(`/login?next=/community/${boardId}`);
      return;
    }
    if (!user.yonseiVerified) {
      setVerifyGateOpen(true);
      return;
    }
    setNoteTarget(target);
    setNoteComposerOpen(true);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-display font-bold text-text-hi">{boardMeta?.name ?? "게시판"}</h1>
          {boardMeta && <p className="text-body-sm text-text-lo">{boardMeta.description}</p>}
        </div>
        <Button onClick={openComposer}>글쓰기</Button>
      </header>

      {posts === null ? (
        <PostSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState title="아직 글이 없어요" description="첫 글을 남겨보세요" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onSendNote={(p) => openNoteComposer({ targetType: "post", targetId: p.id, label: p.title })}
            />
          ))}
        </div>
      )}

      <Modal open={composerOpen} onClose={() => !submitting && setComposerOpen(false)} title="새 글 작성">
        <div className="flex flex-col gap-3.5">
          <Field id="post-title" label="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          <Field
            id="post-body"
            label="내용"
            multiline
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
          />
          {forcedAnonymous ? (
            <p className="text-caption text-text-lo">이 게시판은 익명만 가능해요</p>
          ) : (
            <label className="flex items-center gap-2 text-body-sm text-text-lo">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="h-4 w-4 rounded-sm border-rule accent-spec-b"
              />
              익명으로 작성
            </label>
          )}
          {error && <p className="text-micro text-spec-m">{error}</p>}
          <div className="mt-1 flex gap-2">
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting || !title.trim() || !body.trim()}>
              {submitting ? "올리는 중…" : "올리기"}
            </Button>
            <Button variant="ghost" onClick={() => setComposerOpen(false)} disabled={submitting}>
              취소
            </Button>
          </div>
        </div>
      </Modal>
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
      <CommunityNoteComposer
        open={noteComposerOpen}
        target={noteTarget}
        onClose={() => setNoteComposerOpen(false)}
      />
    </div>
  );
}
