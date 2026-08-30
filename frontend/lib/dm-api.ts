/**
 * 다이렉트 메시지(DM) API 클라이언트 - app/schemas/dm.py(백엔드, 수정 금지)와
 * 1:1 대응. lib/notifications-api.ts와 동일 관례: request()/jsonInit()(lib/api.ts)가
 * Authorization Bearer 토큰 부착을 대신 처리하므로 이 파일은 경로 조립과 타입
 * 매핑에만 집중한다.
 *
 * - 전부 연세대 인증 필수(익명 401 / 미인증 403+X-Auth-Requirement: yonsei-verified) -
 *   읽기(목록·메시지 조회)까지 포함해서 인증 게이트가 걸린다(알림함과 다른 지점).
 * - GET /api/dm → 최신순 최대 30개, peer 프로필이 이미 동봉되므로 추가 조회 불필요.
 * - GET /api/dm/{threadId}/messages → 최신순 최대 50개. 조회하면 내 안읽음이
 *   서버에서 즉시 0으로 리셋된다(호출부 책임 - 배지 갱신하려면 목록을 다시 불러야 함).
 * - POST /api/dm/{peerUid}/messages → 자기 자신 400, 팔로잉/팔로워 어느 쪽에도
 *   없으면 403(맞팔 불필요, 한쪽만 걸쳐도 대화 가능).
 */

import { jsonInit, request } from "./api";

export interface DmPeerDto {
  uid: string;
  displayName?: string;
  avatarEmoji?: string;
}

export interface DmThreadDto {
  id: string;
  peer: DmPeerDto;
  lastMessageAt: number;
  lastMessagePreview: string;
  unread: number;
}

export interface DmThreadListDto {
  items: DmThreadDto[];
  unreadTotal: number;
}

export interface DmMessageDto {
  id: string;
  senderUid: string;
  body: string;
  createdAt: number;
}

export interface DmPartnerDto {
  uid: string;
  displayName?: string;
  avatarEmoji?: string;
  hasThread: boolean;
}

export function listDmThreads(): Promise<DmThreadListDto> {
  return request<DmThreadListDto>("/api/dm");
}

/** 새 대화를 시작할 수 있는 상대(내 팔로잉 ∪ 팔로워, 표시 이름 오름차순, 최대 100명). */
export function listDmPartners(): Promise<DmPartnerDto[]> {
  return request<DmPartnerDto[]>("/api/dm/partners");
}

/** 최신순 최대 50개. 호출하는 순간 서버에서 이 대화방의 내 안읽음이 0으로
 * 리셋된다 - 호출부는 이후 listDmThreads()로 배지를 다시 채워야 한다. */
export function listDmMessages(threadId: string): Promise<DmMessageDto[]> {
  return request<DmMessageDto[]>(`/api/dm/${encodeURIComponent(threadId)}/messages`);
}

export function sendDmMessage(peerUid: string, body: string): Promise<DmMessageDto> {
  return request<DmMessageDto>(
    `/api/dm/${encodeURIComponent(peerUid)}/messages`,
    jsonInit("POST", { body })
  );
}
