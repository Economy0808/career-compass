/**
 * 탐색(Explore) API 클라이언트 - 관심사 기반 사람 찾기(사용자 지시: "공통관심사를
 * 지닌 유저를 소셜에 띄워주는거지. 검색 창도 띄우고").
 *
 * lib/profiles-api.ts와 동일한 관례(request()가 토큰 부착·에러 처리 담당).
 * ⚠ 백엔드 세션과 병렬로 합의된 예상 계약 - 확정 diff가 오면 이 파일만 조정.
 *
 * - GET /api/explore/users → 익명 허용, ≤30명. 로그인 시 나와의 공통 태그
 *   교집합 내림차순 + commonTags 포함, 익명은 최신순. 본인 제외.
 * - GET /api/explore/search?q= → 이름 prefix 검색, ≤20명.
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
}

export function listExploreUsers(): Promise<ExploreUserDto[]> {
  return request<ExploreUserDto[]>("/api/explore/users");
}

export function searchExploreUsers(q: string): Promise<ExploreUserDto[]> {
  return request<ExploreUserDto[]>(`/api/explore/search?q=${encodeURIComponent(q)}`);
}
