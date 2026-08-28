/**
 * 커뮤니티(익명 게시판) API 클라이언트 - 오르비/에타식 여러 게시판.
 *
 * ⚠ 이 계약은 백엔드 세션과 병렬로 합의된 "예상본"이다. 실제 백엔드가
 * 확정되면(GET /api/community/boards 등) 이 파일과 아래 타입을 그에 맞춰
 * 조정해야 한다. lib/api.ts의 request()/jsonInit()를 그대로 재사용해
 * Authorization 토큰 부착과 에러 처리를 통일한다(lib/posts-api.ts와 동일 관례).
 */

import { jsonInit, request } from "./api";

/** 게시판 6종. 서버 GET /api/community/boards 응답이 있으면 그 name/description을
 * 우선 표시하되, id→forcedAnonymous 판정(비밀 게시판 강제 익명)과 서버 실패 시
 * 폴백 목록으로는 이 상수를 쓴다. */
export interface BoardMeta {
  id: string;
  name: string;
  description: string;
  forcedAnonymous: boolean;
}

export const BOARDS: readonly BoardMeta[] = [
  { id: "free", name: "자유", description: "형식 없이 편하게 나누는 이야기", forcedAnonymous: false },
  { id: "secret", name: "비밀", description: "털어놓기 조심스러운 이야기, 항상 익명", forcedAnonymous: true },
  { id: "qna", name: "질문", description: "궁금한 걸 묻고 답하는 곳", forcedAnonymous: false },
  { id: "info", name: "정보", description: "학교생활에 도움 되는 정보 공유", forcedAnonymous: false },
  { id: "career", name: "진로", description: "전공·진로 고민을 나누는 곳", forcedAnonymous: false },
  { id: "promo", name: "홍보", description: "모임·행사·서비스 홍보", forcedAnonymous: false },
] as const;

export function isForcedAnonymousBoard(boardId: string): boolean {
  return BOARDS.find((b) => b.id === boardId)?.forcedAnonymous ?? false;
}

/** 백엔드 BoardOut과 1:1 대응(예상). */
export interface BoardDto {
  id: string;
  name: string;
  description: string;
}

/** 백엔드 CommunityPostOut과 1:1 대응(예상). isAnonymous면 authorName은 응답에서
 * 생략되고, isMine은 로그인 본인 글일 때만 내려온다. */
export interface CommunityPostDto {
  id: string;
  boardId: string;
  title: string;
  body: string;
  isAnonymous: boolean;
  authorName?: string;
  isMine?: boolean;
  likeCount: number;
  commentCount: number;
  createdAt: number;
}

export interface CommunityCommentDto {
  id: string;
  body: string;
  isAnonymous: boolean;
  authorName?: string;
  isMine?: boolean;
  createdAt: number;
}

export interface CommunityPostDetailDto extends CommunityPostDto {
  comments: CommunityCommentDto[];
}

export function listBoards(): Promise<BoardDto[]> {
  return request<BoardDto[]>("/api/community/boards");
}

export function listBoardPosts(boardId: string): Promise<CommunityPostDto[]> {
  return request<CommunityPostDto[]>(`/api/community/boards/${encodeURIComponent(boardId)}/posts`);
}

export function createBoardPost(
  boardId: string,
  input: { title: string; body: string; isAnonymous: boolean }
): Promise<CommunityPostDto> {
  return request<CommunityPostDto>(
    `/api/community/boards/${encodeURIComponent(boardId)}/posts`,
    jsonInit("POST", input)
  );
}

export function getCommunityPost(postId: string): Promise<CommunityPostDetailDto> {
  return request<CommunityPostDetailDto>(`/api/community/posts/${encodeURIComponent(postId)}`);
}

export function addComment(
  postId: string,
  input: { body: string; isAnonymous: boolean }
): Promise<CommunityCommentDto> {
  return request<CommunityCommentDto>(
    `/api/community/posts/${encodeURIComponent(postId)}/comments`,
    jsonInit("POST", input)
  );
}

export function toggleLike(postId: string): Promise<{ likeCount: number; liked: boolean }> {
  return request<{ likeCount: number; liked: boolean }>(
    `/api/community/posts/${encodeURIComponent(postId)}/like`,
    { method: "POST" }
  );
}
