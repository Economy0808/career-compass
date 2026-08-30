/**
 * 둘러보기(데모) 모드 전용 가짜 데이터.
 *
 * app/demo/** 는 로그인 없이 누구나 볼 수 있는 체험 모드라 백엔드 API를 단 한
 * 번도 호출하지 않는다 - 이 파일은 순수 상수/타입만 담고, lib/*-api.ts는
 * import조차 하지 않는다(핵심 제약, 사용자 지시). 특정 학과/전공을 가리키는
 * 예시는 넣지 않는다 - 학년 무관 일반 활동으로만 구성한다.
 */

import type { CanvasEdge, CanvasNode } from "@/components/ConstellationCanvas";

export interface DemoUser {
  uid: string;
  displayName: string;
  bio: string;
  avatarEmoji: string;
  interestTags: string[];
}

// "나"(데모 관측자)의 관심사 - 탐색/추천 카드에서 겹치는 관심사를 lit 칩으로
// 강조하는 연출의 기준점. 실제 로그인 사용자가 없으니 이 데모 세션 동안만
// 쓰는 가상의 기준.
export const DEMO_MY_INTERESTS: readonly string[] = ["글쓰기", "데이터", "창업"];

export const DEMO_USERS: readonly DemoUser[] = [
  {
    uid: "demo-1",
    displayName: "haneul_star",
    bio: "1학년, 아직 뭘 할지 못 정했어요",
    avatarEmoji: "🪐",
    interestTags: ["데이터", "통계", "동아리"],
  },
  {
    uid: "demo-2",
    displayName: "wj_lee",
    bio: "경영 쪽 관심 있는데 자격증부터 알아보는 중",
    avatarEmoji: "🔭",
    interestTags: ["경영", "자격증", "인턴"],
  },
  {
    uid: "demo-3",
    displayName: "soo_writes",
    bio: "글쓰기 스터디 같이 할 사람 찾는 중입니다",
    avatarEmoji: "✍️",
    interestTags: ["글쓰기", "동아리", "네트워킹"],
  },
  {
    uid: "demo-4",
    displayName: "minjun_k",
    bio: "창업 동아리 활동 중, 팀원 구해요",
    avatarEmoji: "🚀",
    interestTags: ["창업", "네트워킹", "인턴"],
  },
  {
    uid: "demo-5",
    displayName: "yuna_intern",
    bio: "여름방학 인턴 준비 중",
    avatarEmoji: "🌙",
    interestTags: ["인턴", "자격증", "데이터"],
  },
  {
    uid: "demo-6",
    displayName: "jihu_reads",
    bio: "교양 뭐 들을지 고민 중",
    avatarEmoji: "📖",
    interestTags: ["글쓰기", "통계", "동아리"],
  },
  {
    uid: "demo-7",
    displayName: "eunji_lab",
    bio: "동아리 회장 하고 있어요, 신입 환영",
    avatarEmoji: "🧭",
    interestTags: ["동아리", "네트워킹", "창업"],
  },
] as const;

/** explore-api의 commonTags 응답 구조를 흉내낸다 - 겹치는 칩만 lit로 강조. */
export function demoCommonTags(user: DemoUser): string[] {
  const mine = new Set(DEMO_MY_INTERESTS);
  return user.interestTags.filter((tag) => mine.has(tag));
}

export interface DemoPost {
  id: string;
  ownerUid: string;
  caption: string;
  likeCount: number;
  commentCount: number;
  createdAtLabel: string;
  /** 외부 이미지 파일 없이 사진 자리를 대신하는 CSS 그라데이션(밤하늘/캠퍼스 톤). */
  gradient: string;
  emoji: string;
}

export const DEMO_POSTS: readonly DemoPost[] = [
  {
    id: "post-1",
    ownerUid: "demo-4",
    caption: "오늘 동아리 부스에서 만난 사람들 — 다들 방향이 달라서 오히려 재밌었다",
    likeCount: 24,
    commentCount: 3,
    createdAtLabel: "3시간 전",
    gradient: "linear-gradient(155deg, var(--spec-k) 0%, var(--ink-900) 72%)",
    emoji: "🏕️",
  },
  {
    id: "post-2",
    ownerUid: "demo-1",
    caption: "통계학입문 과제 끝... 다음엔 뭘 들어야 할지 감이 안 잡힌다",
    likeCount: 11,
    commentCount: 1,
    createdAtLabel: "5시간 전",
    gradient: "linear-gradient(155deg, var(--spec-b) 0%, var(--ink-900) 72%)",
    emoji: "📊",
  },
  {
    id: "post-3",
    ownerUid: "demo-3",
    caption: "글쓰기 스터디 첫 모임 — 다음 주부터 매주 화요일 저녁 7시",
    likeCount: 32,
    commentCount: 5,
    createdAtLabel: "어제",
    gradient: "linear-gradient(155deg, var(--spec-a) 0%, var(--ink-900) 72%)",
    emoji: "✍️",
  },
  {
    id: "post-4",
    ownerUid: "demo-5",
    caption: "인턴 서류 통과했어요! 자격증 준비하길 잘한듯",
    likeCount: 47,
    commentCount: 8,
    createdAtLabel: "이틀 전",
    gradient: "linear-gradient(155deg, var(--spec-m) 0%, var(--ink-900) 72%)",
    emoji: "🌠",
  },
  {
    id: "post-5",
    ownerUid: "demo-7",
    caption: "동아리 신입 모집 마감 임박 — 관심 있으면 프로필로 DM",
    likeCount: 19,
    commentCount: 2,
    createdAtLabel: "3일 전",
    gradient: "linear-gradient(155deg, var(--spec-g) 0%, var(--ink-900) 72%)",
    emoji: "🌌",
  },
] as const;

export interface DemoComment {
  id: string;
  authorUid: string;
  body: string;
}

export const DEMO_INITIAL_COMMENTS: Readonly<Record<string, readonly DemoComment[]>> = {
  "post-1": [{ id: "c1", authorUid: "demo-2", body: "저도 다음에 가볼게요!" }],
  "post-3": [{ id: "c2", authorUid: "demo-6", body: "저 참여하고 싶어요 링크 주실 수 있나요" }],
};

// --- 별자리 잇기 데모 시드 ---------------------------------------------------
// 학과/전공 무관 일반 예시 6~9노드(사용자 지시) + 간선 몇 개. course 타입에는
// 실제 학정번호처럼 보일 code를 넣지 않는다 - 특정 학교 과목 코드로 오인될
// 여지를 없앤다.
export const DEMO_SEED_NODES: readonly CanvasNode[] = [
  {
    id: "n1",
    label: "통계학입문",
    type: "course",
    isCompleted: true,
    position: { x: -260, y: -40 },
    level: 1,
    description: "숫자로 세상을 보는 법을 배우는 1학년 교양",
  },
  {
    id: "n2",
    label: "글쓰기와 커뮤니케이션",
    type: "course",
    isCompleted: true,
    position: { x: -260, y: 130 },
    level: 1,
  },
  {
    id: "n3",
    label: "경영학원론",
    type: "course",
    isCompleted: false,
    position: { x: -60, y: -150 },
    level: 1,
  },
  {
    id: "n4",
    label: "데이터 분석 스터디",
    type: "organization",
    isCompleted: false,
    position: { x: 90, y: -20 },
    description: "학회 형태로 매주 모여 실습 프로젝트를 진행",
  },
  {
    id: "n5",
    label: "자격증 취득",
    type: "certification",
    isCompleted: false,
    position: { x: 280, y: -110 },
  },
  {
    id: "n6",
    label: "여름 인턴십",
    type: "activity",
    isCompleted: false,
    position: { x: 280, y: 110 },
  },
  {
    id: "n7",
    label: "선배 네트워킹",
    type: "networking",
    isCompleted: false,
    position: { x: 60, y: 190 },
  },
  {
    id: "n8",
    label: "학회 활동",
    type: "organization",
    isCompleted: false,
    position: { x: -80, y: 60 },
  },
] as const;

export const DEMO_SEED_EDGES: readonly CanvasEdge[] = [
  { id: "e1", sourceNodeId: "n1", targetNodeId: "n4" },
  { id: "e2", sourceNodeId: "n2", targetNodeId: "n8" },
  { id: "e3", sourceNodeId: "n3", targetNodeId: "n8" },
  { id: "e4", sourceNodeId: "n4", targetNodeId: "n5" },
  { id: "e5", sourceNodeId: "n8", targetNodeId: "n7" },
  { id: "e6", sourceNodeId: "n8", targetNodeId: "n6" },
] as const;

export interface DemoStoryEntry {
  uid: string;
  displayName: string;
  avatarEmoji: string;
  hasUnseen: boolean;
}

export const DEMO_STORY_RING: readonly DemoStoryEntry[] = DEMO_USERS.slice(0, 6).map((u, i) => ({
  uid: u.uid,
  displayName: u.displayName,
  avatarEmoji: u.avatarEmoji,
  hasUnseen: i % 2 === 0,
}));
