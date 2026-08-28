/**
 * 프로필/팔로우 API 클라이언트.
 *
 * 계약 출처: 백엔드 커밋 6765735(ProfileOut 신설).
 *
 * - GET /api/profiles/{uid} → ProfileDto. 익명 허용, 없는 uid는 404.
 *   isFollowing은 로그인 상태로 "타인"을 볼 때만 키가 존재한다(익명/본인
 *   조회 시에는 응답에서 아예 빠진다) - 그래서 `?:` 선택적 필드로 선언한다
 *   (constellation-api.ts의 "없음 vs 0" 구분 관례와 동일한 이유).
 * - PATCH /api/profiles/me → body의 bio는 500자 이하.
 * - POST/DELETE /api/profiles/{uid}/follow → 인증 필수, 분당 30 rate limit
 *   (429 가능) - 갱신된 ProfileDto(isFollowing이 새 상태)를 돌려준다.
 *
 * request()가 Authorization Bearer 토큰 부착을 대신 처리하므로(lib/api.ts),
 * 이 파일은 경로 조립과 타입 매핑에만 집중한다. uid는 Firebase uid라 경로
 * segment에 특수문자가 섞일 수 있으므로 encodeURIComponent로 이스케이프한다.
 */

import { jsonInit, request } from "./api";

/** 백엔드 ProfileOut과 1:1 대응. */
export interface ProfileDto {
  uid: string;
  displayName?: string;
  avatarEmoji?: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
  /** 로그인 상태로 타인을 조회할 때만 존재 - 익명/본인 조회 시 키 자체가 없다. */
  isFollowing?: boolean;
}

export function getProfile(uid: string): Promise<ProfileDto> {
  return request<ProfileDto>(`/api/profiles/${encodeURIComponent(uid)}`);
}

export function patchMyProfile(patch: {
  displayName?: string;
  avatarEmoji?: string;
  bio?: string;
}): Promise<ProfileDto> {
  return request<ProfileDto>("/api/profiles/me", jsonInit("PATCH", patch));
}

export function followUser(uid: string): Promise<ProfileDto> {
  return request<ProfileDto>(`/api/profiles/${encodeURIComponent(uid)}/follow`, {
    method: "POST",
  });
}

export function unfollowUser(uid: string): Promise<ProfileDto> {
  return request<ProfileDto>(`/api/profiles/${encodeURIComponent(uid)}/follow`, {
    method: "DELETE",
  });
}
