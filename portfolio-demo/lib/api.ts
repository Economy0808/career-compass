/**
 * 정적 포트폴리오 데모용 API 계층.
 *
 * 원본(frontend/lib/api.ts)과 함수 시그니처를 동일하게 유지해서 화면
 * 컴포넌트는 거의 그대로 쓴다 — 내부만 fetch(백엔드) 대신
 * lib/mock-data.ts(로컬 상태 + Mock 생성 로직)를 호출하도록 바꿨다.
 * 서버가 없으므로 인증·업로드·구매 등은 지원하지 않는다(호출부 자체를
 * 제거했거나, 실수로 호출돼도 안전하게 실패하도록 남겨뒀다).
 */

import {
  findRoadmapIdByMilestone,
  getBeanRankingList,
  getFeedCards,
  getGoalDetail,
  getRoadmapDetail,
  getUserProfileOut,
  getUserRoadmapCards,
  mockNextQuestion,
  mockSynthesizeRoadmap,
  plantPreviewLocal,
  roadmapProgressAfter,
  toggleFollowLocal,
  toggleMilestoneLocal,
} from "./mock-data";
import type {
  BeanRankingEntry,
  ChatMessageIn,
  ChatResponse,
  CommentOut,
  FeedCardOut,
  FeedScope,
  GoalDetailOut,
  MeOut,
  MilestonePatchResponse,
  RoadmapCardOut,
  RoadmapDetailOut,
  RoadmapPreviewOut,
  UserProfileOut,
} from "./types";

/** 서버 이미지 경로가 없는 정적 데모에서는 그대로 돌려준다(플레이스홀더용). */
export function apiUrl(path: string): string {
  return path;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- auth (정적 데모엔 로그인이 없다 — 항상 "비로그인") ----------

export function getMe(): Promise<MeOut> {
  return Promise.reject(new ApiError(401, "정적 데모에는 로그인이 없어요."));
}
export function postLogout(): Promise<void> {
  return Promise.resolve();
}

// ---------- roadmap 조회 ----------

export async function getFeed(options: { scope?: FeedScope; limit?: number; offset?: number }): Promise<FeedCardOut[]> {
  await delay(120);
  const cards = getFeedCards();
  if (options.scope === "following") return []; // 비로그인 데모는 팔로잉 피드가 없다.
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  return cards.slice(offset, offset + limit);
}

export async function getGoal(id: number): Promise<GoalDetailOut> {
  await delay(80);
  const g = getGoalDetail(id);
  if (!g) throw new ApiError(404, "찾을 수 없는 대목표예요.");
  return g;
}

export async function getRoadmap(id: number): Promise<RoadmapDetailOut> {
  await delay(80);
  const r = getRoadmapDetail(id);
  if (!r) throw new ApiError(404, "찾을 수 없는 로드맵이에요.");
  return r;
}

// ---------- "새 씨앗 심기" — Mock LLM (mock_client.py 포팅) ----------

export async function postChat(_goalRawText: string, messages: ChatMessageIn[]): Promise<ChatResponse> {
  await delay(300);
  const { done, question } = mockNextQuestion(messages);
  if (done) return { done: true, question: null, messages };
  const nextMessages: ChatMessageIn[] = [...messages, { role: "assistant", content: question! }];
  return { done: false, question, messages: nextMessages };
}

export async function generatePreview(
  goalRawText: string,
  _messages: ChatMessageIn[],
  _ncsLclasCodes: string[] = [],
  opts: { signal?: AbortSignal; onStatus?: (s: "pending" | "running" | "done" | "error") => void } = {}
): Promise<RoadmapPreviewOut> {
  opts.onStatus?.("pending");
  await delay(400);
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  opts.onStatus?.("running");
  await delay(900); // 실제 웹서치 흉내 — 데모니까 짧게.
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  return mockSynthesizeRoadmap(goalRawText);
}

export async function postPlant(
  preview: RoadmapPreviewOut,
  goalRawText: string,
  _messages: ChatMessageIn[]
): Promise<RoadmapDetailOut[]> {
  await delay(300);
  return plantPreviewLocal(preview, goalRawText);
}

export async function patchMilestone(milestoneId: number, isCompleted: boolean): Promise<MilestonePatchResponse> {
  await delay(60);
  const milestone = toggleMilestoneLocal(milestoneId, isCompleted);
  const roadmapId = findRoadmapIdByMilestone(milestoneId);
  if (!milestone || roadmapId === null) throw new ApiError(404, "찾을 수 없는 마일스톤이에요.");
  return { milestone, roadmap_id: roadmapId, roadmap_progress_pct: roadmapProgressAfter(roadmapId), beans_awarded: null };
}

export async function followUser(userId: number): Promise<void> {
  await delay(60);
  toggleFollowLocal(userId);
}
export async function unfollowUser(userId: number): Promise<void> {
  await delay(60);
  toggleFollowLocal(userId);
}

// ---------- milestone posts (기록) — 정적 데모에서는 읽기만 지원 ----------

export async function getComments(_milestoneId: number): Promise<CommentOut[]> {
  return [];
}
export function postComment(..._args: unknown[]): Promise<CommentOut> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 댓글을 남길 수 없어요."));
}
export function deleteComment(..._args: unknown[]): Promise<void> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}
export function likePost(..._args: unknown[]): Promise<void> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}
export function unlikePost(..._args: unknown[]): Promise<void> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}

// ---------- profile ----------

export async function getUserProfile(userId: number): Promise<UserProfileOut> {
  await delay(80);
  const p = getUserProfileOut(userId);
  if (!p) throw new ApiError(404, "찾을 수 없는 유저예요.");
  return p;
}
export async function getUserRoadmaps(userId: number): Promise<RoadmapCardOut[]> {
  await delay(80);
  return getUserRoadmapCards(userId);
}
export function patchMyBio(..._args: unknown[]): Promise<UserProfileOut> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 프로필을 수정할 수 없어요."));
}
export function patchRoadmapFeatured(..._args: unknown[]): Promise<RoadmapCardOut> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}
export function patchGoalFeatured(..._args: unknown[]): Promise<FeedCardOut> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}
export function deleteRoadmap(..._args: unknown[]): Promise<void> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 지원하지 않아요."));
}

// ---------- beans ----------

export async function getBeanRanking(): Promise<BeanRankingEntry[]> {
  await delay(80);
  return getBeanRankingList();
}
export function purchaseBeans(..._args: unknown[]): Promise<import("./types").BeanPurchaseResponse> {
  return Promise.reject(new ApiError(403, "정적 데모에서는 콩 구매를 지원하지 않아요."));
}

// ---------- 정적 데모에서 사용하지 않는 원본 API 스텁 ----------
// me가 항상 null이라 이 함수들을 실제로 트리거하는 UI 경로(로그인, 본인 계정
// 관리 등)는 도달 불가능하지만, 그 화면 컴포넌트들이 import는 하고 있어서
// 빌드가 깨지지 않도록 시그니처만 유지한다.

const DEMO_DISABLED = new ApiError(403, "정적 데모에서는 지원하지 않는 기능이에요.");

export function postSignup(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function postVerifyEmail(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function postLogin(..._args: unknown[]): Promise<MeOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function requestPasswordReset(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function confirmPasswordReset(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function deleteAccount(..._args: unknown[]): Promise<void> {
  return Promise.reject(DEMO_DISABLED);
}
export function postSchoolEmailRequest(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function postSchoolEmailVerify(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export function postStudentCard(..._args: unknown[]): Promise<{ detail: string }> {
  return Promise.reject(DEMO_DISABLED);
}
export async function getNcsCategories(): Promise<import("./types").NcsCategory[]> {
  return [];
}
export function postPreview(..._args: unknown[]): Promise<import("./types").PreviewJob> {
  return Promise.reject(DEMO_DISABLED);
}
export function getPreviewStatus(..._args: unknown[]): Promise<import("./types").PreviewJobStatus> {
  return Promise.reject(DEMO_DISABLED);
}
export function putMilestonePost(..._args: unknown[]): Promise<import("./types").MilestonePostOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function deleteMilestonePost(..._args: unknown[]): Promise<void> {
  return Promise.reject(DEMO_DISABLED);
}
export function getTodoDay(..._args: unknown[]): Promise<import("./types").TodoDayOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function getTodoCalendar(..._args: unknown[]): Promise<import("./types").CalendarDayOut[]> {
  return Promise.reject(DEMO_DISABLED);
}
export function createTodoCategory(..._args: unknown[]): Promise<import("./types").TodoCategoryOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function patchTodoCategory(..._args: unknown[]): Promise<import("./types").TodoCategoryOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function deleteTodoCategory(..._args: unknown[]): Promise<void> {
  return Promise.reject(DEMO_DISABLED);
}
export function createTodoItem(..._args: unknown[]): Promise<import("./types").TodoItemOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function patchTodoItem(..._args: unknown[]): Promise<import("./types").TodoItemOut> {
  return Promise.reject(DEMO_DISABLED);
}
export function deleteTodoItem(..._args: unknown[]): Promise<void> {
  return Promise.reject(DEMO_DISABLED);
}
