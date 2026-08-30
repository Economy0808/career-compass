/**
 * 커뮤니티 전용 익명 쪽지 API 클라이언트 (/api/community/notes).
 *
 * lib/posts-api.ts·lib/community-api.ts와 동일한 관례로 request()/jsonInit()
 * (lib/api.ts)만 재사용한다. 백엔드 app/schemas/community_notes.py와 1:1 대응.
 *
 * ⚠ 익명성은 여기 타입에 그대로 반영돼 있다 - NoteThreadDto/NoteMessageDto
 * 어디에도 uid·표시명·아바타 필드가 없다(서버 응답 스키마 자체에 없으므로).
 * 상대는 role(sender/recipient)과 senderLabel(받는 쪽에서만 채워지는 순번)로만
 * 구분한다. 이 파일에 그런 필드를 "추가"하지 말 것 - 백엔드가 절대 보내지 않는다.
 *
 * DM(팔로워 간 실명 대화, lib/dm-api.ts)과는 별개 계약이니 혼동하지 말 것.
 */

import { jsonInit, request } from "./api";

export type NoteTargetType = "post" | "comment";
export type NoteRole = "sender" | "recipient";

/** 백엔드 NoteThreadOut과 1:1 대응. senderUid/recipientUid/표시명/아바타는
 * 어떤 필드로도 존재하지 않는다 - role+senderLabel만으로 화면을 구성해야 한다. */
export interface NoteThreadDto {
  id: string;
  role: NoteRole;
  targetType: NoteTargetType;
  postTitle: string;
  commentExcerpt?: string;
  /** role이 "recipient"일 때만 내려온다(발신자 본인에게는 무의미). */
  senderLabel?: number;
  unread: boolean;
  blocked: boolean;
  createdAt: number;
  lastMessageAt: number;
}

export interface NoteInboxDto {
  threads: NoteThreadDto[];
  unreadCount: number;
}

/** 백엔드 NoteMessageOut과 1:1 대응. from_role 대신 mine 하나로만 구분한다. */
export interface NoteMessageDto {
  id: string;
  mine: boolean;
  body: string;
  createdAt: number;
}

export interface NoteThreadMessagesDto {
  thread: NoteThreadDto;
  messages: NoteMessageDto[];
}

/** 쪽지 시작 또는 기존 스레드에 이어붙이기. targetType이 "comment"면 postId
 * 필수(없으면 서버 400) - 댓글이 속한 글 id다. */
export function startOrContinueNote(input: {
  targetType: NoteTargetType;
  targetId: string;
  postId?: string;
  body: string;
}): Promise<NoteThreadDto> {
  return request<NoteThreadDto>("/api/community/notes", jsonInit("POST", input));
}

/** 내 쪽지함 - 보낸 것+받은 것 병합, 최신순 최대 30건. */
export function listMyNotes(): Promise<NoteInboxDto> {
  return request<NoteInboxDto>("/api/community/notes");
}

/** 스레드 메시지 최신순 최대 50건. 호출하면 서버가 내 안읽음을 리셋한다. */
export function getThreadMessages(threadId: string): Promise<NoteThreadMessagesDto> {
  return request<NoteThreadMessagesDto>(
    `/api/community/notes/${encodeURIComponent(threadId)}/messages`
  );
}

export function replyToThread(threadId: string, body: string): Promise<NoteMessageDto> {
  return request<NoteMessageDto>(
    `/api/community/notes/${encodeURIComponent(threadId)}/messages`,
    jsonInit("POST", { body })
  );
}

/** 받는 쪽만 호출 가능(보낸 쪽이 부르면 서버 403) - 익명 괴롭힘 방지. */
export function blockThread(threadId: string): Promise<NoteThreadDto> {
  return request<NoteThreadDto>(`/api/community/notes/${encodeURIComponent(threadId)}/block`, {
    method: "POST",
  });
}
