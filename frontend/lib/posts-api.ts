/**
 * 프로필 사진 게시물(Post) API 클라이언트 - 인스타식 사진+짧은 글.
 *
 * lib/profiles-api.ts와 동일한 관례를 따른다: request()/jsonInit()(lib/api.ts)가
 * Authorization Bearer 토큰 부착을 대신 처리하므로 이 파일은 경로 조립과 타입
 * 매핑에만 집중한다. 이미지는 Cloud Storage 대신 data URL(base64)을 그대로
 * 실어 보낸다(백엔드 app/domain/post.py 참고 - Storage 이관 전 임시 구조).
 *
 * P1~P3(다중 사진·좋아요·댓글·단건 조회) 계약은 백엔드 8af3323으로 확정 -
 * 생성은 images(1~10)와 imageData(단일, 역호환) 중 하나 필수, 둘 다 오면
 * images 우선. 댓글 DELETE(본인만)는 아직 UI 미배선.
 *
 * - POST /api/posts → 인증 필수, images 1~10장, 분당 10 rate limit(429 가능).
 * - GET /api/posts/user/{uid} → 익명 허용. 목록은 대표 썸네일(imageData)만.
 * - GET /api/posts/{postId} → 익명 허용, {post, comments} 중첩(community 관례).
 * - GET /api/posts/{postId}/images → 익명 허용, 전체 이미지(지연 로드용).
 * - POST/DELETE /api/posts/{postId}/like → 인증 필수, 응답=갱신된 PostOut.
 * - POST /api/posts/{postId}/comments → 인증 필수, body ≤500, 분당 20.
 * - DELETE /api/posts/{postId} → 인증+소유자 필수, 204.
 */

import { jsonInit, request } from "./api";

/** 백엔드 PostOut과 1:1 대응. imageData는 대표(첫 장) 이미지 - 목록·그리드용.
 * isLiked는 로그인 시에만 내려온다(exclude_none 관례). */
export interface PostDto {
  id: string;
  ownerId: string;
  imageData: string;
  caption: string;
  createdAt: number;
  imageCount: number;
  likeCount: number;
  commentCount: number;
  isLiked?: boolean;
}

/** SNS층 댓글 - 커뮤니티와 달리 익명 없음(실명 스냅샷, 백엔드 8af3323 확정). */
export interface PostCommentDto {
  id: string;
  body: string;
  authorUid: string;
  authorDisplayName?: string;
  createdAt: number;
}

/** 상세 화면 편의용 평탄화 타입 - 서버는 {post, comments} 중첩으로 주지만
 * getPost가 여기서 평탄화한다(lib/community-api.ts와 동일 관례). */
export interface PostDetailDto extends PostDto {
  comments: PostCommentDto[];
}

export function createPost(input: { images: string[]; caption?: string }): Promise<PostDto> {
  return request<PostDto>("/api/posts", jsonInit("POST", input));
}

export function listUserPosts(uid: string): Promise<PostDto[]> {
  return request<PostDto[]>(`/api/posts/user/${encodeURIComponent(uid)}`);
}

/** SNS 피드 항목 - 화면 편의용 평탄화 타입. 서버(254e6e9 확정)는
 * {post, author} 중첩(constellation FeedItemOut 관례)으로 주고, listFeedPosts가
 * 여기서 평탄화한다. */
export interface FeedPostDto extends PostDto {
  ownerDisplayName?: string;
  ownerAvatarEmoji?: string;
}

/** 전체 게시물 피드(최신 ≤30, 익명 허용) - /feed SNS 전환용. */
export function listFeedPosts(): Promise<FeedPostDto[]> {
  return request<{ post: PostDto; author: { uid: string; displayName?: string; avatarEmoji?: string } }[]>(
    "/api/posts/feed"
  ).then((list) =>
    list.map((item) => ({
      ...item.post,
      ownerDisplayName: item.author.displayName,
      ownerAvatarEmoji: item.author.avatarEmoji,
    }))
  );
}

export async function getPost(postId: string): Promise<PostDetailDto> {
  const raw = await request<{ post: PostDto; comments: PostCommentDto[] }>(
    `/api/posts/${encodeURIComponent(postId)}`
  );
  return { ...raw.post, comments: raw.comments };
}

/** 전체 이미지 지연 로드 - 목록·그리드는 대표 썸네일만 들고 다니고, 확대 뷰가
 * 열릴 때만 이걸 부른다(다중 장수 문서 크기 방어). 응답은 [{index, imageData}]
 * (8af3323 확정, 순서 보장·레거시 글은 썸네일 1장 폴백)이며 여기서 data URL
 * 배열로 평탄화한다. */
export function listPostImages(postId: string): Promise<string[]> {
  return request<{ index: number; imageData: string }[]>(
    `/api/posts/${encodeURIComponent(postId)}/images`
  ).then((list) => list.map((item) => item.imageData));
}

/** 좋아요는 토글 단일 엔드포인트가 아니라 POST/DELETE 분리(C1 관례) - 응답은
 * 갱신된 글 전체(likeCount+isLiked 포함)다. */
export function likePost(postId: string): Promise<PostDto> {
  return request<PostDto>(`/api/posts/${encodeURIComponent(postId)}/like`, { method: "POST" });
}

export function unlikePost(postId: string): Promise<PostDto> {
  return request<PostDto>(`/api/posts/${encodeURIComponent(postId)}/like`, { method: "DELETE" });
}

export function addPostComment(postId: string, body: string): Promise<PostCommentDto> {
  return request<PostCommentDto>(
    `/api/posts/${encodeURIComponent(postId)}/comments`,
    jsonInit("POST", { body })
  );
}

export function deletePost(postId: string): Promise<void> {
  return request<void>(`/api/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}
