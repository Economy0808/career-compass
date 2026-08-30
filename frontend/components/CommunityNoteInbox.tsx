"use client";

/*
 * 쪽지함 패널 - 목록 → 대화 → 답장 → (받는 쪽이면) 차단.
 *
 * 이 컴포넌트는 스스로 우상단 아이콘을 그리지 않는다 - 메인 스레드가 셸의
 * 아이콘 슬롯에 열림 상태를 꽂을 것이므로, open/onClose를 props로만 받고
 * 자체 패널 UI(Modal)만 제공한다. 안읽음 개수는 useCommunityNoteUnread()
 * 훅으로 밖에서 알 수 있게 export한다.
 *
 * ⚠ 상대 식별 정보(uid·표시명·아바타)는 서버 응답 어디에도 없다(계약 자체가
 * 그렇게 생겼다 - lib/community-notes-api.ts 참고). role+senderLabel로만
 * 화면을 구성하고, 어떤 경로로도 프로필 링크를 만들지 않는다.
 *
 * 안읽음 배지 동기화: 이 파일 안의 모듈 전역 스토어(unreadStore)를 훅과
 * 패널이 함께 구독한다 - 셸에 Provider를 새로 심을 수 없으므로(shell 편집
 * 금지) React Context 대신 최소한의 pub/sub로 해결한다.
 */

import { useEffect, useState } from "react";
import { Button, EmptyState, Field, Modal } from "@/components/ui";
import { VerifyGate, isVerifyRequiredError } from "@/components/VerifyGate";
import { relativeTimeKo } from "@/lib/format";
import {
  blockThread,
  getThreadMessages,
  listMyNotes,
  replyToThread,
  type NoteMessageDto,
  type NoteThreadDto,
} from "@/lib/community-notes-api";

const MAX_NOTE_BODY_LEN = 1000;

// ---------- 안읽음 개수 공유 스토어 (모듈 전역, Context 없이 최소 pub/sub) ----------

let unreadCount = 0;
let loaded = false;
const listeners = new Set<() => void>();

function setUnreadCount(n: number) {
  unreadCount = n;
  loaded = true;
  listeners.forEach((l) => l());
}

/** 셸의 아이콘 배지에서 쓰는 훅 - 마운트 시 한 번 불러오고, 이후 패널의
 * 액션(목록 새로고침·읽음 리셋·차단)이 갱신하면 자동으로 따라간다. */
export function useCommunityNoteUnread(): number {
  const [count, setCount] = useState(unreadCount);
  useEffect(() => {
    const listener = () => setCount(unreadCount);
    listeners.add(listener);
    if (!loaded) {
      listMyNotes()
        .then((inbox) => setUnreadCount(inbox.unreadCount))
        .catch(() => {
          // 비로그인/미인증이면 조용히 0 유지 - 배지는 셸이 어차피 로그인 상태로 감쌀 것.
        });
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return count;
}

// ---------- 패널 ----------

type View = { kind: "list" } | { kind: "thread"; threadId: string };

function threadLabel(thread: NoteThreadDto): string {
  // 받는 쪽에서만 senderLabel이 오므로, 없으면(내가 보낸 스레드) "나"로 표시.
  return thread.role === "recipient" && thread.senderLabel != null
    ? `익명${thread.senderLabel}`
    : "나";
}

function ThreadRow({ thread, onOpen }: { thread: NoteThreadDto; onOpen: () => void }) {
  const targetLabel =
    thread.targetType === "comment" && thread.commentExcerpt
      ? `"${thread.commentExcerpt}" 댓글`
      : thread.postTitle;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-rule bg-ink-800/70 p-3.5 text-left backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text-hi">{threadLabel(thread)}</span>
        <div className="flex items-center gap-1.5">
          {thread.unread && <span className="h-2 w-2 rounded-full bg-spec-b" aria-label="안읽음" />}
          <span className="text-caption text-text-lo">{relativeTimeKo(thread.lastMessageAt)}</span>
        </div>
      </div>
      <p className="mt-1 truncate text-caption text-text-lo">{targetLabel}</p>
    </button>
  );
}

function MessageRow({ message }: { message: NoteMessageDto }) {
  return (
    <div className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
      <div
        className={
          "max-w-[80%] rounded-lg border border-rule px-3.5 py-2.5 text-body-sm " +
          (message.mine ? "bg-spec-b/12 text-text-hi" : "bg-ink-800/70 text-text-hi")
        }
      >
        <p className="whitespace-pre-wrap">{message.body}</p>
        <p className="mt-1 text-micro text-text-lo">{relativeTimeKo(message.createdAt)}</p>
      </div>
    </div>
  );
}

export interface CommunityNoteInboxProps {
  open: boolean;
  onClose: () => void;
}

export function CommunityNoteInbox({ open, onClose }: CommunityNoteInboxProps) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [threads, setThreads] = useState<NoteThreadDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [threadDetail, setThreadDetail] = useState<NoteThreadDto | null>(null);
  const [messages, setMessages] = useState<NoteMessageDto[] | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);

  function loadInbox() {
    setThreads(null);
    setLoadError(false);
    listMyNotes()
      .then((inbox) => {
        setThreads(inbox.threads);
        setUnreadCount(inbox.unreadCount);
      })
      .catch((err) => {
        if (isVerifyRequiredError(err)) {
          setVerifyGateOpen(true);
        }
        setLoadError(true);
      });
  }

  useEffect(() => {
    if (!open) return;
    setView({ kind: "list" });
    setError(null);
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openThread(threadId: string) {
    setView({ kind: "thread", threadId });
    setThreadDetail(null);
    setMessages(null);
    setError(null);
    getThreadMessages(threadId)
      .then((res) => {
        setThreadDetail(res.thread);
        setMessages(res.messages);
        // 서버가 조회 시 안읽음을 리셋하므로, 목록 쪽 배지도 즉시 맞춰준다.
        setThreads((prev) =>
          prev ? prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)) : prev
        );
        listMyNotes()
          .then((inbox) => setUnreadCount(inbox.unreadCount))
          .catch(() => {});
      })
      .catch((err) => {
        if (isVerifyRequiredError(err)) setVerifyGateOpen(true);
        setError("대화를 불러오지 못했어요.");
      });
  }

  async function handleReply(): Promise<void> {
    if (view.kind !== "thread" || !replyBody.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const sent = await replyToThread(view.threadId, replyBody.trim());
      setMessages((prev) => (prev ? [sent, ...prev] : prev));
      setReplyBody("");
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setVerifyGateOpen(true);
        return;
      }
      const blocked = typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 403;
      setError(blocked ? "상대가 이 대화를 차단했어요." : "쪽지를 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  }

  async function handleBlock(): Promise<void> {
    if (view.kind !== "thread" || blocking) return;
    setBlocking(true);
    setError(null);
    try {
      const updated = await blockThread(view.threadId);
      setThreadDetail(updated);
    } catch {
      setError("차단하지 못했어요.");
    } finally {
      setBlocking(false);
    }
  }

  function handleClose() {
    setReplyBody("");
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={handleClose} title={view.kind === "list" ? "쪽지함" : "쪽지"} size="sm">
        {view.kind === "list" ? (
          loadError ? (
            <EmptyState title="쪽지함을 불러오지 못했어요" description="잠시 후 다시 시도해주세요" />
          ) : threads === null ? (
            <div className="flex flex-col gap-2" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-rule bg-ink-800/70" />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <EmptyState title="아직 쪽지가 없어요" description="커뮤니티 글이나 댓글에서 쪽지를 보내보세요" />
          ) : (
            <div className="flex flex-col gap-2">
              {threads.map((t) => (
                <ThreadRow key={t.id} thread={t} onOpen={() => openThread(t.id)} />
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3.5">
            <button
              type="button"
              onClick={() => setView({ kind: "list" })}
              className="self-start text-caption text-text-lo underline-offset-2 hover:underline"
            >
              ← 목록으로
            </button>
            {threadDetail && (
              <p className="truncate rounded-md border border-rule bg-ink-900/60 px-3.5 py-2.5 text-caption text-text-lo">
                {threadDetail.targetType === "comment" && threadDetail.commentExcerpt
                  ? `"${threadDetail.commentExcerpt}" 댓글`
                  : threadDetail.postTitle}
              </p>
            )}
            {messages === null ? (
              <div className="flex flex-col gap-2" aria-hidden>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-ink-800/70" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <p className="text-caption text-text-lo">아직 메시지가 없어요</p>
            ) : (
              <div className="flex max-h-80 flex-col-reverse gap-2 overflow-y-auto">
                {messages.map((m) => (
                  <MessageRow key={m.id} message={m} />
                ))}
              </div>
            )}
            {threadDetail?.blocked ? (
              <p className="text-caption text-text-lo">이 대화는 차단됐어요</p>
            ) : (
              <>
                <Field
                  id="note-reply"
                  label="답장"
                  multiline
                  rows={2}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  maxLength={MAX_NOTE_BODY_LEN}
                />
                {error && <p className="text-micro text-spec-m">{error}</p>}
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" onClick={handleReply} disabled={sending || !replyBody.trim()}>
                    {sending ? "보내는 중…" : "답장 보내기"}
                  </Button>
                  {threadDetail?.role === "recipient" && (
                    <Button variant="danger" size="sm" onClick={handleBlock} disabled={blocking}>
                      {blocking ? "차단 중…" : "차단"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
    </>
  );
}
