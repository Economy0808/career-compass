"use client";

/*
 * 쪽지 케밥 메뉴 + 작성 모달 - 커뮤니티 글/댓글 어디서나 재사용한다
 * (app/community/[boardId]/page.tsx, app/community/post/[postId]/page.tsx).
 *
 * 케밥 아이콘 모양은 app/profile/[id]/page.tsx의 KebabIcon 패턴을 그대로
 * 옮겨온 것(그 파일은 건드리지 않는다, 사용자 지시). 본인 글/댓글에는 이
 * 메뉴 자체를 렌더링하지 말 것 - 호출부가 CommunityPostDto/CommunityCommentDto의
 * isMine으로 판단해 컴포넌트를 아예 안 그리면 된다(서버도 400으로 막지만
 * UI에서 미리 감추는 게 사용자 지시).
 *
 * ⚠ 여기서도 상대의 uid·표시명·아바타를 다루지 않는다 - 보내는 쪽 화면에는
 * 애초에 그런 정보가 없다(대상 글/댓글의 제목·내용 일부만 라벨로 보여준다).
 */

import { useState } from "react";
import { Button, Field, Modal } from "@/components/ui";
import { VerifyGate, isVerifyRequiredError } from "@/components/VerifyGate";
import { startOrContinueNote, type NoteTargetType } from "@/lib/community-notes-api";

const MAX_NOTE_BODY_LEN = 1000;

/** 케밥(세로 점 3개) 아이콘 - app/profile/[id]/page.tsx의 KebabIcon과 동일 모양. */
function KebabIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5.5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="18.5" r="1.7" />
    </svg>
  );
}

export interface NoteKebabMenuProps {
  /** "쪽지 보내기"를 누르면 호출된다 - 호출부가 대상 정보를 들고 컴포저를 연다. */
  onSendNote: () => void;
  ariaLabel: string;
}

/** 케밥 버튼 + "쪽지 보내기" 단일 항목 드롭다운. 본인 대상이면 호출부가 아예
 * 렌더링하지 않아야 한다(isMine 판정은 호출부 책임). */
export function NoteKebabMenu({ onSendNote, ariaLabel }: NoteKebabMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
      >
        <KebabIcon />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1.5 w-36 overflow-hidden rounded-lg border border-rule bg-ink-800/95 shadow-panel backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSendNote();
              }}
              className="block w-full px-3.5 py-2.5 text-left text-body-sm text-text-hi transition-colors hover:bg-ink-700"
            >
              쪽지 보내기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export interface NoteTarget {
  targetType: NoteTargetType;
  targetId: string;
  /** targetType이 "comment"일 때만 필요(계약: 댓글은 postId 동봉 필수). */
  postId?: string;
  /** 작성 모달에 보여줄 대상 요약(글 제목 또는 댓글 일부) - 상대 식별 정보는 아니다. */
  label: string;
}

export interface CommunityNoteComposerProps {
  open: boolean;
  target: NoteTarget | null;
  onClose: () => void;
  /** 전송 성공 후 호출(쪽지함 배지 갱신 등은 호출부 책임). */
  onSent?: () => void;
}

/** 쪽지 작성 모달 - 대상 요약 + 본문 입력 + 보내기. 미인증(403)이면 VerifyGate로
 * 넘긴다. */
export function CommunityNoteComposer({ open, target, onClose, onSent }: CommunityNoteComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);

  function handleClose() {
    if (sending) return;
    setBody("");
    setError(null);
    onClose();
  }

  async function handleSend(): Promise<void> {
    if (!target || !body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await startOrContinueNote({
        targetType: target.targetType,
        targetId: target.targetId,
        postId: target.postId,
        body: body.trim(),
      });
      setBody("");
      onClose();
      onSent?.();
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setVerifyGateOpen(true);
        return;
      }
      setError("쪽지를 보내지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Modal open={open && target !== null} onClose={handleClose} title="쪽지 보내기" size="sm">
        {target && (
          <div className="flex flex-col gap-3.5">
            <p className="truncate rounded-md border border-rule bg-ink-900/60 px-3.5 py-2.5 text-caption text-text-lo">
              {target.label}
            </p>
            <Field
              id="note-body"
              label="내용"
              multiline
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_NOTE_BODY_LEN}
              placeholder="상대에게는 익명으로 전달돼요"
            />
            {error && <p className="text-micro text-spec-m">{error}</p>}
            <div className="mt-1 flex gap-2">
              <Button className="flex-1" onClick={handleSend} disabled={sending || !body.trim()}>
                {sending ? "보내는 중…" : "보내기"}
              </Button>
              <Button variant="ghost" onClick={handleClose} disabled={sending}>
                취소
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
    </>
  );
}
