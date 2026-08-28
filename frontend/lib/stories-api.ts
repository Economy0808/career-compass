/**
 * 스토리(Story) API 클라이언트 - 인스타식 24시간 만료.
 *
 * 계약 출처: 백엔드 f96fb04(app/api/stories.py, app/schemas/stories.py).
 * lib/posts-api.ts와 동일한 관례를 따른다: request()/jsonInit()(lib/api.ts)가
 * Authorization Bearer 토큰 부착을 대신 처리하므로 이 파일은 경로 조립과 타입
 * 매핑에만 집중한다. 이미지 필드명은 posts와 동일하게 imageData(camelCase)다.
 *
 * - POST /api/stories → 인증 필수, 분당 10 rate limit(429 가능).
 * - GET /api/stories/user/{uid} → 활성(만료 전)만·시간순, 익명 허용.
 * - GET /api/stories/ring → 인증 필수. 본인 + 팔로잉 중 활성 스토리 보유자.
 * - POST /api/stories/{id}/view → 열람 기록(익명은 서버가 no-op 200 처리).
 * - DELETE /api/stories/{id} → 인증+소유자 필수, 204.
 */

import { jsonInit, request } from "./api";

/** 백엔드 StoryOut과 1:1 대응. */
export interface StoryDto {
  id: string;
  ownerId: string;
  imageData: string;
  createdAt: number;
  expiresAt: number;
}

/** 백엔드 StoryRingItemOut과 1:1 대응. */
export interface StoryRingEntryDto {
  uid: string;
  displayName?: string;
  avatarEmoji?: string;
  hasUnseen: boolean;
}

export function createStory(imageData: string): Promise<StoryDto> {
  return request<StoryDto>("/api/stories", jsonInit("POST", { imageData }));
}

export function listUserStories(uid: string): Promise<StoryDto[]> {
  return request<StoryDto[]>(`/api/stories/user/${encodeURIComponent(uid)}`);
}

export function getStoryRing(): Promise<StoryRingEntryDto[]> {
  return request<StoryRingEntryDto[]>("/api/stories/ring");
}

export function markStoryViewed(storyId: string): Promise<void> {
  return request<void>(`/api/stories/${encodeURIComponent(storyId)}/view`, { method: "POST" });
}

export function deleteStory(storyId: string): Promise<void> {
  return request<void>(`/api/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
}
