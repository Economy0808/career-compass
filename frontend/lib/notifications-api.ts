/**
 * 별(✦) 알림함 API 클라이언트 - app/schemas/notifications.py(백엔드, 수정 금지)와
 * 1:1 대응. lib/posts-api.ts와 동일 관례: request()가 인증 헤더를 대신 처리하므로
 * 이 파일은 경로 조립과 타입 매핑에만 집중한다.
 *
 * - GET /api/notifications → 인증 필수(익명 401). 개별 읽음 처리 API는 없다 -
 *   read-all(전체 일괄)만 존재한다.
 * - actor는 프로필 문서가 아예 없는 stub 유저면 없을 수 있고, exclude_none이라
 *   키 자체가 응답에서 빠질 수 있다 - 옵셔널로 선언(호출부가 옵셔널 체이닝 필수).
 */

import { request } from "./api";

export interface NotificationActorDto {
  displayName?: string;
  avatarEmoji?: string;
}

export interface NotificationDto {
  id: string;
  actorUid: string;
  actor?: NotificationActorDto;
  type: "follow" | "like" | "comment";
  postId?: string;
  createdAt: number;
  read: boolean;
}

export interface NotificationListDto {
  items: NotificationDto[];
  unreadCount: number;
}

export function listNotifications(): Promise<NotificationListDto> {
  return request<NotificationListDto>("/api/notifications");
}

export function markAllNotificationsRead(): Promise<void> {
  return request<void>("/api/notifications/read-all", { method: "POST" });
}
