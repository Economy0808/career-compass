"use client";

/**
 * DM(다이렉트 메시지) 패널 내용물 - 대화 목록 → 대화 열기 → 전송.
 * components/shell/MessageIcon.tsx가 패널 다이얼로그(제목줄·닫기·바깥클릭·포커스
 * 트랩)를 소유하고, 이 컴포넌트는 그 안의 목록/대화 UI만 담당한다.
 *
 * 새 대화 시작: 목록 상단 "새 대화" 버튼 -> 팔로잉/팔로워 상대 목록(GET
 * /api/dm/partners) -> hasThread면 기존 스레드로, 아니면 빈 대화 화면에서
 * 첫 메시지를 보내면 POST /api/dm/{peerUid}/messages가 방을 만든다.
 * 폴링 없음: MessageIcon이 패널을 열 때만 이 컴포넌트가 마운트되므로 최초 1회
 * 조회가 곧 "열 때마다 재조회"와 같다(알림함과 동일한 패턴).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  listDmMessages,
  listDmPartners,
  listDmThreads,
  sendDmMessage,
  type DmMessageDto,
  type DmPartnerDto,
  type DmThreadDto,
} from "@/lib/dm-api";
import { relativeTimeKo } from "@/lib/format";
import { isVerifyRequiredError, VerifyGate } from "@/components/VerifyGate";

export interface DmPanelProps {
  /** 대화방 목록을 새로 불러올 때마다 최신 안읽음 합계를 부모(MessageIcon)의
   * 뱃지로 끌어올린다 - 패널이 닫혀 있을 때도 뱃지는 계속 보여야 해서 상태를
   * 여기서 소유하지 않고 콜백으로 올린다. */
  onUnreadTotalChange?: (total: number) => void;
  /** 알림함의 dm 알림 클릭(lib/message-panel-bus.ts)으로 열렸을 때, 최초
   * 목록 로드 직후 이 상대와의 대화를 자동으로 연다. 목록에 이 상대와의
   * 스레드가 없으면(팔로우 관계가 끊겼거나 등) 조용히 목록만 보여준다 -
   * 에러 화면을 띄우지 않는다. */
  initialPeerUid?: string;
}

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export function DmPanel({ onUnreadTotalChange, initialPeerUid }: DmPanelProps) {
  const [threads, setThreads] = useState<DmThreadDto[] | null>(null);
  const [active, setActive] = useState<DmThreadDto | null>(null);
  const [messages, setMessages] = useState<DmMessageDto[] | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showVerifyGate, setShowVerifyGate] = useState(false);
  // "새 대화" 진입 상태 - showPartners는 상대 목록 화면, composePeer는 아직
  // 스레드가 없는 상대에게 첫 메시지를 쓰는 빈 대화 화면이다. 서로 배타적이며
  // active(기존 스레드)가 최우선으로 렌더된다.
  const [showPartners, setShowPartners] = useState(false);
  const [partners, setPartners] = useState<DmPartnerDto[] | null>(null);
  const [composePeer, setComposePeer] = useState<DmPartnerDto | null>(null);
  // initialPeerUid 자동 열기는 최초 목록 로드 1회만 - openThread()가 내부에서
  // loadThreads()를 다시 부르므로(안읽음 갱신) 이 가드가 없으면 재귀적으로
  // 계속 같은 스레드를 다시 연다.
  const autoOpenedRef = useRef(false);

  function loadThreads() {
    listDmThreads()
      .then((res) => {
        setThreads(res.items);
        onUnreadTotalChange?.(res.unreadTotal);
        if (!autoOpenedRef.current && initialPeerUid) {
          autoOpenedRef.current = true;
          const target = res.items.find((t) => t.peer.uid === initialPeerUid);
          if (target) openThread(target);
          // 목록에 없으면 조용히 목록만 보여준다(에러 화면 금지 - 지시).
        }
      })
      .catch((err) => {
        if (isVerifyRequiredError(err)) setShowVerifyGate(true);
        setThreads([]);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadThreads, []);

  function openThread(thread: DmThreadDto) {
    setShowPartners(false);
    setComposePeer(null);
    setActive(thread);
    setMessages(null);
    setSendError(null);
    listDmMessages(thread.id)
      .then((msgs) => {
        setMessages(msgs);
        // 조회 즉시 이 방의 안읽음이 서버에서 0으로 리셋되므로 목록을 다시 불러
        // 뱃지(unreadTotal)를 갱신한다.
        loadThreads();
      })
      .catch((err) => {
        if (isVerifyRequiredError(err)) setShowVerifyGate(true);
        setMessages([]);
      });
  }

  function openPartnerList() {
    setShowPartners(true);
    if (partners === null) {
      listDmPartners()
        .then(setPartners)
        .catch((err) => {
          if (isVerifyRequiredError(err)) setShowVerifyGate(true);
          setPartners([]);
        });
    }
  }

  /** 파트너 목록에서 상대를 골랐을 때 - 이미 스레드가 있으면 그걸 이어가고,
   * 없으면 빈 대화 화면으로 보낸다. hasThread=true인데 최근 30개 목록 안에
   * 없는 드문 경우(스레드가 많아 밀려난 경우)는 빈 대화 화면으로 안전하게
   * 넘긴다 - 어차피 전송 API는 스레드 존재 여부와 무관하게 동작한다. */
  function openPartner(p: DmPartnerDto) {
    if (!p.hasThread) {
      setShowPartners(false);
      setComposePeer(p);
      return;
    }
    listDmThreads()
      .then((res) => {
        setThreads(res.items);
        onUnreadTotalChange?.(res.unreadTotal);
        const found = res.items.find((t) => t.peer.uid === p.uid);
        if (found) {
          openThread(found);
        } else {
          setShowPartners(false);
          setComposePeer(p);
        }
      })
      .catch((err) => {
        if (isVerifyRequiredError(err)) setShowVerifyGate(true);
      });
  }

  async function handleComposeSend() {
    const trimmed = body.trim();
    if (!composePeer || !trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendDmMessage(composePeer.uid, trimmed);
      setBody("");
      // 첫 메시지 전송이 방을 만들었으니 목록을 다시 불러 그 스레드로 전환한다.
      const res = await listDmThreads();
      setThreads(res.items);
      onUnreadTotalChange?.(res.unreadTotal);
      const created = res.items.find((t) => t.peer.uid === composePeer.uid);
      setComposePeer(null);
      if (created) openThread(created);
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setShowVerifyGate(true);
      } else if (isForbidden(err)) {
        setSendError("서로 팔로우한 사이에서만 대화할 수 있어요");
      } else {
        setSendError("전송하지 못했어요. 다시 시도해주세요.");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const trimmed = body.trim();
    if (!active || !trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendDmMessage(active.peer.uid, trimmed);
      setMessages((prev) => (prev ? [sent, ...prev] : [sent]));
      setBody("");
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setShowVerifyGate(true);
      } else if (isForbidden(err)) {
        setSendError("서로 팔로우한 사이에서만 대화할 수 있어요");
      } else {
        setSendError("전송하지 못했어요. 다시 시도해주세요.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VerifyGate open={showVerifyGate} onClose={() => setShowVerifyGate(false)} />
      {active ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-paper-line px-4 py-2.5">
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="대화 목록으로"
              className="rounded-sm p-1 text-paper-lo transition-colors hover:text-paper-ink"
            >
              <span aria-hidden className="block text-body leading-none">
                ‹
              </span>
            </button>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper text-base">
              {active.peer.avatarEmoji ?? "🔭"}
            </span>
            <span className="truncate text-body-sm font-semibold text-paper-ink">
              {active.peer.displayName ?? "관측자"}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto px-4 py-3">
            {messages === null ? (
              <p className="py-10 text-center text-body-sm text-paper-lo">불러오는 중이에요</p>
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-body-sm text-paper-lo">
                첫 메시지를 보내보세요
              </p>
            ) : (
              // 서버는 최신순으로 주지만 대화창은 옛→최신 순으로 위→아래 읽혀야
              // 하고, flex-col-reverse 컨테이너에서는 배열 순서를 뒤집지 않고
              // 그대로(최신이 먼저) 넣어야 시각적으로 최신이 맨 아래에 온다.
              messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    "max-w-[80%] rounded-lg px-3 py-2 text-body-sm " +
                    (m.senderUid === active.peer.uid
                      ? "self-start bg-paper text-paper-ink"
                      : "self-end bg-paper-ink text-paper")
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={
                      "mt-1 text-micro " +
                      (m.senderUid === active.peer.uid ? "text-paper-lo" : "text-paper/70")
                    }
                  >
                    {relativeTimeKo(m.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-paper-line px-3 py-2.5">
            {sendError && <p className="mb-1.5 text-micro text-spec-m">{sendError}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="메시지 보내기"
                className="min-h-11 flex-1 resize-none rounded-md border border-paper-line bg-paper px-3 py-2.5 text-body-sm text-paper-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!body.trim() || sending}
                aria-label="보내기"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-paper-ink text-paper transition-opacity disabled:opacity-40"
              >
                <span aria-hidden className="block text-body leading-none">
                  ↑
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : composePeer ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-paper-line px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                setComposePeer(null);
                setBody("");
                setSendError(null);
                setShowPartners(true);
              }}
              aria-label="상대 목록으로"
              className="rounded-sm p-1 text-paper-lo transition-colors hover:text-paper-ink"
            >
              <span aria-hidden className="block text-body leading-none">
                ‹
              </span>
            </button>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper text-base">
              {composePeer.avatarEmoji ?? "🔭"}
            </span>
            <span className="truncate text-body-sm font-semibold text-paper-ink">
              {composePeer.displayName ?? "관측자"}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto px-4 py-3">
            <p className="py-10 text-center text-body-sm text-paper-lo">첫 메시지를 보내보세요</p>
          </div>

          <div className="border-t border-paper-line px-3 py-2.5">
            {sendError && <p className="mb-1.5 text-micro text-spec-m">{sendError}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleComposeSend();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="메시지 보내기"
                className="min-h-11 flex-1 resize-none rounded-md border border-paper-line bg-paper px-3 py-2.5 text-body-sm text-paper-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
              />
              <button
                type="button"
                onClick={() => void handleComposeSend()}
                disabled={!body.trim() || sending}
                aria-label="보내기"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-paper-ink text-paper transition-opacity disabled:opacity-40"
              >
                <span aria-hidden className="block text-body leading-none">
                  ↑
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : showPartners ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-paper-line px-4 py-2.5">
            <button
              type="button"
              onClick={() => setShowPartners(false)}
              aria-label="대화 목록으로"
              className="rounded-sm p-1 text-paper-lo transition-colors hover:text-paper-ink"
            >
              <span aria-hidden className="block text-body leading-none">
                ‹
              </span>
            </button>
            <span className="text-body-sm font-semibold text-paper-ink">새 대화</span>
          </div>
          <div className="overflow-y-auto">
            {partners === null ? (
              <p className="px-4 py-10 text-center text-body-sm text-paper-lo">불러오는 중이에요</p>
            ) : partners.length === 0 ? (
              <p className="px-4 py-10 text-center text-body-sm text-paper-lo">
                먼저 팔로우하면 대화할 수 있어요{" "}
                <Link href="/explore" className="underline">
                  탐색하러 가기
                </Link>
              </p>
            ) : (
              partners.map((p) => (
                <button
                  key={p.uid}
                  type="button"
                  onClick={() => openPartner(p)}
                  className="flex w-full items-center gap-3 border-b border-paper-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-paper"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-lg">
                    {p.avatarEmoji ?? "🔭"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-paper-ink">
                    {p.displayName ?? "관측자"}
                  </span>
                  {p.hasThread && (
                    <span className="shrink-0 text-caption text-paper-lo">대화 중</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-paper-line px-4 py-2.5">
            <button
              type="button"
              onClick={openPartnerList}
              className="rounded-sm text-body-sm font-semibold text-paper-ink transition-colors hover:text-paper-lo"
            >
              + 새 대화
            </button>
          </div>
          <div className="overflow-y-auto">
            {threads === null ? (
              <p className="px-4 py-10 text-center text-body-sm text-paper-lo">불러오는 중이에요</p>
            ) : threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-body-sm text-paper-lo">
                아직 나눈 대화가 없어요
              </p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t)}
                  className="flex w-full items-start gap-3 border-b border-paper-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-paper"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-lg">
                    {t.peer.avatarEmoji ?? "🔭"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-body-sm font-semibold text-paper-ink">
                        {t.peer.displayName ?? "관측자"}
                      </span>
                      <span className="shrink-0 text-caption text-paper-lo">
                        {relativeTimeKo(t.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="truncate text-caption text-paper-lo">
                        {t.lastMessagePreview}
                      </span>
                      {t.unread > 0 && (
                        <span
                          aria-hidden
                          className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-spec-b px-1 font-mono text-micro font-semibold leading-none text-paper"
                        >
                          {t.unread > 99 ? "99+" : t.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
