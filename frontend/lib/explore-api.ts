/**
 * 탐색(Explore) API 클라이언트 - 관심사 기반 사람 찾기(사용자 지시: "공통관심사를
 * 지닌 유저를 소셜에 띄워주는거지. 검색 창도 띄우고").
 *
 * lib/profiles-api.ts와 동일한 관례(request()가 토큰 부착·에러 처리 담당).
 * ⚠ 백엔드 세션과 병렬로 합의된 예상 계약 - 확정 diff가 오면 이 파일만 조정.
 *
 * - GET /api/explore/users → 익명 허용, ≤30명. 로그인 시 나와의 공통 태그
 *   교집합 내림차순 + commonTags 포함, 익명은 최신순. 본인 제외.
 * - GET /api/explore/search?q= → q가 "@"로 시작하면 닉네임 부분일치, 아니면
 *   이름·소개·관심사 부분일치(로그인 시 내 관심사와 겹치는 수 내림차순), ≤20명.
 * - interestTags는 발행된 별자리들의 요소 빈도 상위 5개(발행 시점 비정규화).
 */

import { request } from "./api";

export interface ExploreUserDto {
  uid: string;
  displayName?: string;
  avatarEmoji?: string;
  bio?: string;
  interestTags: string[];
  /** 로그인 시에만: 나의 관심사와 겹치는 태그(카드에서 lit 강조). */
  commonTags?: string[];
  /** 로그인 상태로 타인을 볼 때만 실린다(익명이면 키 자체가 없음, 본인은 애초에
   * 목록에서 제외된다 - profiles의 isFollowing 관례와 동일). 계약 `eaf9bb0`.
   * 추천(/users)은 이미 팔로우한 사람을 아예 빼주므로 여기서는 대개 false지만,
   * 검색(/search)은 팔로우 중인 사람도 노출하므로 true가 실려 온다. */
  isFollowing?: boolean;
}

export function listExploreUsers(): Promise<ExploreUserDto[]> {
  return request<ExploreUserDto[]>("/api/explore/users");
}

export function searchExploreUsers(q: string): Promise<ExploreUserDto[]> {
  return request<ExploreUserDto[]>(`/api/explore/search?q=${encodeURIComponent(q)}`);
}
