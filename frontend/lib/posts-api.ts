/**
 * 프로필 사진 게시물(Post) API 클라이언트 - 인스타식 사진+짧은 글.
 *
 * lib/profiles-api.ts와 동일한 관례를 따른다: request()/jsonInit()(lib/api.ts)가
 * Authorization Bearer 토큰 부착을 대신 처리하므로 이 파일은 경로 조립과 타입
 * 매핑에만 집중한다. 이미지는 Cloud Storage 대신 data URL(base64)을 그대로
 * imageData에 실어 보낸다(백엔드 app/domain/post.py 참고 - Storage 이관 전
 * 임시 구조).
 *
 * - POST /api/posts → 인증 필수, 분당 10 rate limit(429 가능).
 * - GET /api/posts/user/{uid} → 익명 허용.
 * - DELETE /api/posts/{postId} → 인증+소유자 필수, 204.
 */

import { jsonInit, request } from "./api";

/** 백엔드 PostOut과 1:1 대응. */
export interface PostDto {
  id: string;
  ownerId: string;
  imageData: string;
  caption: string;
  createdAt: number;
}

export function createPost(input: { imageData: string; caption?: string }): Promise<PostDto> {
  return request<PostDto>("/api/posts", jsonInit("POST", input));
}

export function listUserPosts(uid: string): Promise<PostDto[]> {
  return request<PostDto[]>(`/api/posts/user/${encodeURIComponent(uid)}`);
}

export function deletePost(postId: string): Promise<void> {
  return request<void>(`/api/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}
