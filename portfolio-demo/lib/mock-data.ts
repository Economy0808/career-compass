/**
 * 정적 포트폴리오 데모용 목업 데이터 + 상태 계층.
 *
 * backend/scripts/seed_demo_data.py의 시드 데이터를 그대로 미러링한다 (같은
 * 유저·목표·로드맵·마일스톤). 서버가 없으므로 "쓰기"는 전부 브라우저
 * localStorage에만 쌓인다 — 새로고침해도 그 브라우저에서는 유지되지만,
 * 다른 방문자와는 공유되지 않고 언제든 초기화될 수 있다(데모 목적상 의도됨).
 */

import type {
  BeanRankingEntry,
  CareerGoalDecision,
  ChatMessageIn,
  FeedCardOut,
  GoalDetailOut,
  MilestoneOut,
  MilestoneStatus,
  RoadmapCardOut,
  RoadmapDetailOut,
  RoadmapItemPreview,
  RoadmapPreviewOut,
  UserOut,
  UserProfileOut,
} from "./types";

// ---------- 시드 유저 (seed_demo_data.py DEMO_USERS와 동일) ----------

export interface SeedUser extends UserOut {
  username: string;
  bio: string;
  yonsei_verified: boolean;
}

/** 방문자 본인(비로그인 게스트)을 가리키는 고정 id — 실제 계정이 아니다. */
export const VISITOR_ID = 0;
const VISITOR_USER: SeedUser = {
  id: VISITOR_ID,
  username: "guest",
  display_name: "방문자",
  avatar_emoji: "🌱",
  bio: "",
  yonsei_verified: false,
};

export const SEED_USERS: SeedUser[] = [
  { id: 1, username: "demo_jaemin", display_name: "재민", avatar_emoji: "🦉", bio: "데이터로 진로 찾는 중", yonsei_verified: true },
  { id: 2, username: "demo_soyeon", display_name: "소연", avatar_emoji: "🐰", bio: "UX 디자이너 준비생", yonsei_verified: true },
  { id: 3, username: "demo_doyun", display_name: "도윤", avatar_emoji: "🐢", bio: "천천히, 그러나 꾸준히", yonsei_verified: false },
  { id: 4, username: "demo_haeun", display_name: "하은", avatar_emoji: "🦊", bio: "백엔드 개발자가 목표", yonsei_verified: true },
  { id: 5, username: "demo_minjun", display_name: "민준", avatar_emoji: "🐼", bio: "회계사 시험 준비중", yonsei_verified: false },
  { id: 6, username: "demo_yuna", display_name: "유나", avatar_emoji: "🌙", bio: "마케터로 커리어 전환", yonsei_verified: true },
];

interface SeedMilestoneSpec {
  title: string;
  description: string;
  detail: string;
  offset: number;
  done: boolean;
}
interface SeedGoalSpec {
  userIndex: number;
  goalTitle: string;
  goalContext: string;
  roadmapTitle: string;
  goalRawText: string;
  milestones: SeedMilestoneSpec[];
}

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-25T00:00:00Z").getTime();
function dueDate(offset: number): string {
  return new Date(NOW + offset * DAY_MS).toISOString().slice(0, 10);
}

const SEED_GOALS: SeedGoalSpec[] = [
  {
    userIndex: 0,
    goalTitle: "데이터 분석가 되기",
    goalContext: "3학년, 통계학 전공, 주당 15시간 투자 가능. SQL/파이썬 기초 있음.",
    roadmapTitle: "데이터 분석가 취업 로드맵",
    goalRawText: "데이터 분석가가 되고 싶어",
    milestones: [
      { title: "SQL 기초 학습", description: "SQL 기본 문법과 JOIN 익히기", detail: "SQL 기본 문법과 JOIN 익히기", offset: -30, done: true },
      { title: "Python 데이터 분석 기초", description: "pandas, numpy로 데이터 다루는 법 학습", detail: "pandas, numpy로 데이터 다루는 법 학습", offset: -10, done: true },
      { title: "포트폴리오 프로젝트 1개", description: "공공데이터로 분석 프로젝트 완성", detail: "공공데이터로 분석 프로젝트 완성", offset: 7, done: false },
      { title: "데이터 분석 부트캠프 지원", description: "국비지원 부트캠프 3곳 지원", detail: "국비지원 부트캠프 3곳 지원", offset: 30, done: false },
      { title: "인턴십 지원", description: "데이터 분석 직무 인턴 지원 시작", detail: "데이터 분석 직무 인턴 지원 시작", offset: 60, done: false },
    ],
  },
  {
    userIndex: 1,
    goalTitle: "UX 디자이너 전환",
    goalContext: "2학년, 시각디자인 전공, 포트폴리오 0개.",
    roadmapTitle: "UX 디자이너 포트폴리오 만들기",
    goalRawText: "UX 디자이너가 되고 싶어",
    milestones: [
      { title: "UX 리서치 기초 학습", description: "사용자 인터뷰, 설문 설계 학습", detail: "사용자 인터뷰, 설문 설계 학습", offset: -15, done: true },
      { title: "Figma 툴 숙련", description: "Figma로 와이어프레임/프로토타입 제작 연습", detail: "Figma로 와이어프레임/프로토타입 제작 연습", offset: -2, done: false },
      { title: "리디자인 프로젝트 1개", description: "기존 앱 하나 골라 리디자인", detail: "기존 앱 하나 골라 리디자인", offset: 21, done: false },
      { title: "포트폴리오 웹사이트 제작", description: "프로젝트 3개로 포트폴리오 사이트 완성", detail: "프로젝트 3개로 포트폴리오 사이트 완성", offset: 60, done: false },
    ],
  },
  {
    userIndex: 2,
    goalTitle: "공인회계사(CPA) 1차 합격",
    goalContext: "4학년, 경영학 전공, 올해 1차 응시 목표.",
    roadmapTitle: "CPA 1차 시험 준비",
    goalRawText: "공인회계사가 되고 싶어",
    milestones: [
      { title: "회계원리 기초 완강", description: "회계원리 인강 완강 및 기본서 1회독", detail: "회계원리 인강 완강 및 기본서 1회독", offset: -20, done: true },
      { title: "세법 기본서 1회독", description: "세법 기본 개념 정리", detail: "세법 기본 개념 정리", offset: -3, done: false },
      { title: "재무관리 기본서 1회독", description: "재무관리 기본 개념 정리", detail: "재무관리 기본 개념 정리", offset: 20, done: false },
      { title: "모의고사 5회 응시", description: "실전 모의고사로 시간 배분 연습", detail: "실전 모의고사로 시간 배분 연습", offset: 50, done: false },
      { title: "1차 시험 응시", description: "CPA 1차 시험 응시", detail: "CPA 1차 시험 응시", offset: 90, done: false },
    ],
  },
  {
    userIndex: 3,
    goalTitle: "백엔드 개발자, 스타트업 취업",
    goalContext: "3학년, 컴퓨터공학 전공, FastAPI 토이프로젝트 1개 경험.",
    roadmapTitle: "백엔드 개발자 취업 로드맵",
    goalRawText: "백엔드 개발자로 스타트업에 취업하고 싶어",
    milestones: [
      { title: "Python/FastAPI 기초", description: "FastAPI로 간단한 API 서버 만들기", detail: "FastAPI로 간단한 API 서버 만들기", offset: -25, done: true },
      { title: "DB 설계 및 SQL 심화", description: "정규화, 인덱스, 쿼리 최적화 학습", detail: "정규화, 인덱스, 쿼리 최적화 학습", offset: -8, done: true },
      { title: "사이드 프로젝트 배포", description: "개인 프로젝트 클라우드에 배포", detail: "개인 프로젝트 클라우드에 배포", offset: 10, done: false },
      { title: "오픈소스 기여 1건", description: "관심 있는 오픈소스 프로젝트에 PR 제출", detail: "관심 있는 오픈소스 프로젝트에 PR 제출", offset: 40, done: false },
      { title: "스타트업 채용 지원", description: "스타트업 5곳 이상 지원", detail: "스타트업 5곳 이상 지원", offset: 70, done: false },
    ],
  },
  {
    userIndex: 4,
    goalTitle: "전략 컨설턴트(MBB) 되기",
    goalContext: "1학년, 무전공, 케이스인터뷰 경험 없음.",
    roadmapTitle: "컨설팅 케이스인터뷰 준비",
    goalRawText: "전략 컨설턴트가 되고 싶어",
    milestones: [
      { title: "케이스인터뷰 기초체력 완성 #1", description: "구조화 사고, 프레임워크 학습", detail: "구조화 사고, 프레임워크 학습", offset: -12, done: false },
      { title: "케이스 스터디 그룹 참여", description: "매주 케이스 2개씩 실전 연습", detail: "매주 케이스 2개씩 실전 연습", offset: 5, done: false },
      { title: "리서치 프로젝트 1건", description: "산업 분석 리포트 작성", detail: "산업 분석 리포트 작성", offset: 35, done: false },
    ],
  },
  {
    userIndex: 5,
    goalTitle: "마케터로 커리어 전환",
    goalContext: "3학년, 심리학 전공, 인턴 경험 1회.",
    roadmapTitle: "마케팅 직무 전환 로드맵",
    goalRawText: "그로스 마케터가 되고 싶어",
    milestones: [
      { title: "퍼포먼스 마케팅 기초", description: "GA4, 메타 광고 매니저 학습", detail: "GA4, 메타 광고 매니저 학습", offset: -18, done: true },
      { title: "SNS 콘텐츠 캠페인 1건", description: "개인 채널로 캠페인 기획·집행", detail: "개인 채널로 캠페인 기획·집행", offset: -1, done: true },
      { title: "마케팅 인턴 지원", description: "스타트업 마케팅 인턴 5곳 지원", detail: "스타트업 마케팅 인턴 5곳 지원", offset: 25, done: false },
    ],
  },
];

// ---------- 파생 정적 자료구조 (모듈 로드 시 1회 빌드) ----------

interface BuiltGoal {
  id: number;
  userIndex: number; // -1 = 방문자(브라우저 로컬 생성분)
  title: string;
  context: string;
  createdAt: string;
  isFeatured: boolean;
}
interface BuiltRoadmap {
  id: number;
  userIndex: number;
  goalId: number;
  title: string;
  goalRawText: string;
  createdAt: string;
  milestones: MilestoneOut[];
  isFeatured: boolean;
}

const goals: BuiltGoal[] = [];
const roadmaps: BuiltRoadmap[] = [];
let nextGoalId = 1;
let nextRoadmapId = 1;
let nextMilestoneId = 1;

function computeStatus(dueIso: string, doneManual: boolean): MilestoneStatus {
  if (doneManual) return "완료";
  return dueIso < dueDate(0) ? "기한초과" : "진행중";
}

SEED_GOALS.forEach((spec) => {
  const goalId = nextGoalId++;
  const roadmapId = nextRoadmapId++;
  const createdAt = new Date(NOW - 5 * DAY_MS).toISOString();
  goals.push({ id: goalId, userIndex: spec.userIndex, title: spec.goalTitle, context: spec.goalContext, createdAt, isFeatured: true });
  const milestones: MilestoneOut[] = spec.milestones.map((m, i) => {
    const due = dueDate(m.offset);
    return {
      id: nextMilestoneId++,
      order_index: i,
      title: m.title,
      description: m.description,
      detail: m.detail,
      due_date: due,
      is_completed_manual: m.done,
      completed_at: m.done ? createdAt : null,
      status: computeStatus(due, m.done),
      post: null,
    };
  });
  roadmaps.push({ id: roadmapId, userIndex: spec.userIndex, goalId, title: spec.roadmapTitle, goalRawText: spec.goalRawText, createdAt, milestones, isFeatured: true });
});

// ---------- localStorage 로컬 상태 ----------

const STORAGE_KEY = "ourcompass-demo-state-v1";

interface LocalState {
  follows: Array<[number, number]>;
  milestoneOverrides: Record<number, boolean>;
  createdRoadmaps: BuiltRoadmap[];
  createdGoals: BuiltGoal[];
}

function emptyState(): LocalState {
  return { follows: [], milestoneOverrides: {}, createdRoadmaps: [], createdGoals: [] };
}
function loadLocalState(): LocalState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<LocalState>) };
  } catch {
    return emptyState();
  }
}
function saveLocalState(state: LocalState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let local = loadLocalState();

function allGoals(): BuiltGoal[] {
  return [...goals, ...local.createdGoals];
}
function allRoadmaps(): BuiltRoadmap[] {
  return [...roadmaps, ...local.createdRoadmaps];
}
function userOf(userIndex: number): SeedUser {
  if (userIndex === -1) return VISITOR_USER;
  return SEED_USERS[userIndex] ?? SEED_USERS[0];
}
function milestoneWithOverride(m: MilestoneOut): MilestoneOut {
  const override = local.milestoneOverrides[m.id];
  if (override === undefined) return m;
  return { ...m, is_completed_manual: override, status: computeStatus(m.due_date, override), completed_at: override ? new Date().toISOString() : null };
}
function progressPct(milestones: MilestoneOut[]): number {
  if (milestones.length === 0) return 0;
  const done = milestones.filter((m) => milestoneWithOverride(m).is_completed_manual).length;
  return Math.round((done / milestones.length) * 1000) / 10;
}
function isFollowing(followeeId: number): boolean | null {
  return local.follows.some(([f, t]) => f === VISITOR_ID && t === followeeId);
}

// ---------- 공개 API ----------

export function toUserOut(u: SeedUser): UserOut {
  return { id: u.id, display_name: u.display_name, avatar_emoji: u.avatar_emoji };
}

export function getFeedCards(): FeedCardOut[] {
  return allGoals()
    .filter((g) => g.isFeatured)
    .map((g) => {
      const roadmap = allRoadmaps().find((r) => r.goalId === g.id);
      const milestones = roadmap ? roadmap.milestones.map(milestoneWithOverride) : [];
      const user = userOf(g.userIndex);
      return {
        id: g.id,
        user: toUserOut(user),
        title: g.title,
        progress_pct: progressPct(milestones),
        milestone_count: milestones.length,
        created_at: g.createdAt,
        is_following: isFollowing(user.id),
        is_featured: g.isFeatured,
        is_withered: false,
        major_goal_title: null,
        major_goal_id: null,
        major_goal_featured: null,
        kind: "goal",
        completed_count: milestones.filter((m) => m.is_completed_manual).length,
      } satisfies FeedCardOut;
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getGoalDetail(goalId: number): GoalDetailOut | null {
  const g = allGoals().find((x) => x.id === goalId);
  if (!g) return null;
  const user = userOf(g.userIndex);
  const myRoadmaps = allRoadmaps().filter((r) => r.goalId === goalId);
  const subRoadmaps = myRoadmaps.map((r) => {
    const ms = r.milestones.map(milestoneWithOverride);
    return { id: r.id, title: r.title, progress_pct: progressPct(r.milestones), status: ms.length ? ms[ms.length - 1].status : ("진행중" as MilestoneStatus), is_withered: false };
  });
  const allMs = myRoadmaps.flatMap((r) => r.milestones.map(milestoneWithOverride));
  return {
    id: g.id,
    user: toUserOut(user),
    title: g.title,
    created_at: g.createdAt,
    progress_pct: progressPct(myRoadmaps.flatMap((r) => r.milestones)),
    completed_count: allMs.filter((m) => m.is_completed_manual).length,
    roadmaps: subRoadmaps,
    is_following: isFollowing(user.id),
    is_featured: g.isFeatured,
  };
}

export function getRoadmapDetail(roadmapId: number): RoadmapDetailOut | null {
  const r = allRoadmaps().find((x) => x.id === roadmapId);
  if (!r) return null;
  const user = userOf(r.userIndex);
  const goal = allGoals().find((g) => g.id === r.goalId);
  return {
    id: r.id,
    user: toUserOut(user),
    title: r.title,
    goal_raw_text: r.goalRawText,
    created_at: r.createdAt,
    progress_pct: progressPct(r.milestones),
    milestones: r.milestones.map(milestoneWithOverride),
    is_following: isFollowing(user.id),
    is_withered: false,
    major_goal_title: goal?.title ?? null,
  };
}

export function getUserProfileOut(userId: number): UserProfileOut | null {
  const seedUser = userId === VISITOR_ID ? VISITOR_USER : SEED_USERS.find((u) => u.id === userId);
  if (!seedUser) return null;
  return {
    id: seedUser.id,
    display_name: seedUser.display_name,
    avatar_emoji: seedUser.avatar_emoji,
    bio: seedUser.bio,
    yonsei_verified: seedUser.yonsei_verified,
    roadmap_count: allRoadmaps().filter((r) => userOf(r.userIndex).id === userId).length,
    follower_count: local.follows.filter(([, t]) => t === userId).length,
    following_count: local.follows.filter(([f]) => f === userId).length,
    is_following: isFollowing(userId),
    bean_balance: 0,
  };
}

export function getUserRoadmapCards(userId: number): RoadmapCardOut[] {
  return allRoadmaps()
    .filter((r) => userOf(r.userIndex).id === userId)
    .map((r) => {
      const user = userOf(r.userIndex);
      const goal = allGoals().find((g) => g.id === r.goalId);
      return {
        id: r.id,
        user: toUserOut(user),
        title: r.title,
        progress_pct: progressPct(r.milestones),
        milestone_count: r.milestones.length,
        created_at: r.createdAt,
        is_following: isFollowing(user.id),
        is_featured: r.isFeatured,
        is_withered: false,
        major_goal_title: goal?.title ?? null,
        major_goal_id: goal?.id ?? null,
        major_goal_featured: goal?.isFeatured ?? null,
      } satisfies RoadmapCardOut;
    });
}

export function getBeanRankingList(): BeanRankingEntry[] {
  const counts: Array<{ uid: number; beans: number }> = [];
  allRoadmaps().forEach((r) => {
    const ms = r.milestones.map(milestoneWithOverride);
    if (ms.length === 0 || !ms.every((m) => m.is_completed_manual)) return;
    const uid = userOf(r.userIndex).id;
    const existing = counts.find((c) => c.uid === uid);
    if (existing) existing.beans += 10;
    else counts.push({ uid, beans: 10 });
  });
  return counts
    .sort((a, b) => b.beans - a.beans)
    .map(({ uid, beans }, i) => ({
      rank: i + 1,
      user: toUserOut(uid === VISITOR_ID ? VISITOR_USER : SEED_USERS.find((u) => u.id === uid)!),
      beans_earned: beans,
    }));
}

// ---------- 쓰기 (브라우저 로컬 전용) ----------

export function toggleFollowLocal(userId: number): boolean {
  const already = isFollowing(userId);
  local = { ...local, follows: already ? local.follows.filter(([f, t]) => !(f === VISITOR_ID && t === userId)) : [...local.follows, [VISITOR_ID, userId]] };
  saveLocalState(local);
  return !already;
}

export function toggleMilestoneLocal(milestoneId: number, isCompleted: boolean): MilestoneOut | null {
  local = { ...local, milestoneOverrides: { ...local.milestoneOverrides, [milestoneId]: isCompleted } };
  saveLocalState(local);
  for (const r of allRoadmaps()) {
    const found = r.milestones.find((m) => m.id === milestoneId);
    if (found) return milestoneWithOverride(found);
  }
  return null;
}
export function findRoadmapIdByMilestone(milestoneId: number): number | null {
  for (const r of allRoadmaps()) if (r.milestones.some((m) => m.id === milestoneId)) return r.id;
  return null;
}
export function roadmapProgressAfter(roadmapId: number): number {
  const r = allRoadmaps().find((x) => x.id === roadmapId);
  return r ? progressPct(r.milestones) : 0;
}

// ---------- Mock 로드맵 생성 (backend/app/llm/mock_client.py 포팅) ----------

const FIXED_QUESTIONS = [
  "그 목표는 언제까지 이루고 싶으신가요?",
  "지금까지 이 분야에서 해본 경험이나 준비가 있나요?",
  "일주일에 이 목표를 위해 쓸 수 있는 시간은 대략 어느 정도인가요?",
  "특별히 끌리는 세부 분야나 역할이 있나요? (아직 몰라도 괜찮아요)",
  "혼자 파고드는 것과 사람들과 함께하는 것 중 어느 쪽이 더 잘 맞나요?",
];
const GOAL_SUFFIXES = ["이 되고 싶어", "가 되고 싶어", "하고 싶어", "하고싶어", "되고 싶어"];
type Step = [title: string, desc: string, detail: string];

const CORE_OPENING: Step[] = [
  ["기초 개념 잡기", "{goal}의 핵심 개념과 용어를 훑는다.", "{goal}이 실제로 어떤 일이고 어떤 역량이 필요한지 전체 지도를 그린다. 입문 강의 1개 또는 개론서 1권을 정해 끝까지 본다. 완료 기준: 핵심 용어 10개를 내 말로 설명할 수 있다."],
  ["필수 도구 익히기", "가장 많이 쓰는 도구 하나를 손에 익힌다.", "이 분야에서 가장 기본이 되는 도구·언어를 하나 골라 튜토리얼을 따라 해본다. 완료 기준: 간단한 예제를 남의 도움 없이 처음부터 끝까지 만들어본다."],
  ["작은 실습 해보기", "배운 걸 아주 작은 결과물로 만들어본다.", "규모가 작아도 좋으니 직접 손을 움직여 결과물 하나를 완성한다. 완벽함보다 '끝까지 완성'이 목표. 완료 기준: 남에게 보여줄 수 있는 결과물 1개가 생긴다."],
];
const CORE_CLOSING: Step[] = [
  ["대표 결과물 완성", "포트폴리오에 남길 결과물 하나를 제대로 완성한다.", "지금까지 배운 것을 모아 '이건 자신 있게 보여줄 수 있다' 싶은 결과물 하나를 만든다. 과정과 배운 점을 짧게 정리해 함께 남긴다. 완료 기준: 포트폴리오/깃허브 등에 공개할 수 있는 결과물 1개."],
  ["실전 기회에 도전", "실제 지원·공모전·시험 등에 한 번 부딪혀본다.", "학회 지원, 공모전, 대외활동, 자격 시험 등 실제 기회 하나에 지원해본다. 합격 여부보다 '실전 경험'이 목적. 완료 기준: 최소 1곳에 실제로 지원서를 제출한다."],
  ["회고하고 다음 목표 잡기", "지금까지를 점검하고 다음 도약점을 정한다.", "무엇이 늘었고 무엇이 부족한지 정리하고, 다음에 도달할 구체적 목표를 새로 잡는다. 완료 기준: 다음 3개월 목표를 한 문장으로 적는다."],
];
const EXTRA_STEPS: Step[] = [
  ["심화 주제 파기", "{goal}에서 특히 중요한 주제 하나를 깊게 판다.", "기초를 넘어 실무에서 자주 쓰이는 심화 주제를 하나 골라 집중적으로 공부한다. 완료 기준: 그 주제로 짧은 정리 글이나 예제를 만든다."],
  ["현직자·선배 만나기", "이 길을 먼저 간 사람에게 이야기를 듣는다.", "관련 키워드로 현직자나 선배를 찾아 커피챗을 요청하거나 커뮤니티에 참여한다. 완료 기준: 최소 1명과 대화하거나 커뮤니티 1곳에 가입한다."],
  ["실무 자료로 연습", "실제와 비슷한 자료·과제로 연습해본다.", "교과서 예제가 아니라 실제에 가까운 데이터·문제로 연습하며 감을 키운다. 완료 기준: 실무형 과제 1개를 처음부터 끝까지 해결한다."],
  ["중간 점검하기", "지금까지의 진행을 되돌아보고 계획을 조정한다.", "계획대로 되고 있는지 점검하고, 막힌 부분과 남은 시간을 보며 이후 일정을 조정한다. 완료 기준: 남은 마일스톤의 순서·기한을 한 번 다듬는다."],
  ["협업 경험 쌓기", "다른 사람과 함께 무언가를 만들어본다.", "스터디, 팀 프로젝트, 오픈소스 기여 등 혼자가 아닌 협업 경험을 한 번 쌓는다. 완료 기준: 2명 이상과 함께한 결과물이 1개 생긴다."],
  ["기록하고 공유하기", "배운 과정을 글이나 발표로 남겨 공유한다.", "학습·프로젝트 과정을 블로그 글, 발표, SNS 등으로 정리해 공개한다. 설명하려다 보면 이해가 단단해진다. 완료 기준: 공개된 기록 1개를 남긴다."],
];

function strippedGoal(text: string): string {
  const t = text.trim();
  for (const suf of GOAL_SUFFIXES) if (t.endsWith(suf)) return t.slice(0, -suf.length).trim();
  return t;
}
function crc32(str: string): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) crc = table[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function milestoneCount(goalText: string): number {
  return 6 + (crc32(goalText.trim()) % 7); // MIN=6, MAX=12
}

export function mockNextQuestion(messages: ChatMessageIn[]): { done: boolean; question: string | null } {
  const asked = messages.filter((m) => m.role === "assistant").length;
  if (asked >= FIXED_QUESTIONS.length) return { done: true, question: null };
  return { done: false, question: FIXED_QUESTIONS[asked] };
}

function buildMilestonePreviews(steps: Step[], goal: string): { title: string; description: string; detail: string; due_date: string }[] {
  const spanStart = 14;
  const spanEnd = 180;
  const denom = Math.max(steps.length - 1, 1);
  return steps.map(([title, descT, detailT], i) => ({
    title,
    description: descT.replace("{goal}", goal),
    detail: detailT.replace("{goal}", goal),
    due_date: dueDate(Math.round(spanStart + ((spanEnd - spanStart) * i) / denom)),
  }));
}

export function mockSynthesizeRoadmap(goalRawText: string): RoadmapPreviewOut {
  const goal = goalRawText.trim();
  const count = milestoneCount(goal);
  const extras = EXTRA_STEPS.slice(0, count - 6);
  const stripped = strippedGoal(goal);

  let careerGoal: CareerGoalDecision = { existing_id: null, title: `${stripped} 되기`, context: "현재 수준: 미상 (mock)", is_new: true };
  for (const g of allGoals()) {
    const core = g.title.endsWith(" 되기") ? g.title.slice(0, -4).trim() : g.title;
    if (core && goal.includes(core)) {
      careerGoal = { existing_id: g.id, title: g.title, context: g.context, is_new: false };
      break;
    }
  }

  const briefing =
    `${stripped}를 이루려면 기초 역량과 실전 경험이 필요해요. 지금 단계에서는 6개월 안에 도달 가능한 ` +
    `'회고하고 다음 목표 잡기' 같은 소목표부터 도전하는 게 현실적이라, 기초와 실전 두 갈래로 나눴어요. ` +
    `아래 로드맵이 마음에 들면 심어주세요.`;

  const items: RoadmapItemPreview[] = [
    { title: `${stripped} 기초 다지기`, milestones: buildMilestonePreviews([...CORE_OPENING, ...extras], goal) },
    { title: `${stripped} 실전 도전`, milestones: buildMilestonePreviews(CORE_CLOSING, goal) },
  ];

  return {
    briefing,
    ncs_job_code: null,
    career_goal: careerGoal,
    roadmaps: items,
    source_urls: ["https://www.jobplanet.co.kr/", "https://dacon.io/", "https://www.dataq.or.kr/"],
  };
}

export function plantPreviewLocal(preview: RoadmapPreviewOut, goalRawText: string): RoadmapDetailOut[] {
  const createdAt = new Date().toISOString();
  let goalId: number;
  let goalRecord: BuiltGoal;
  if (preview.career_goal.existing_id !== null) {
    goalId = preview.career_goal.existing_id;
    goalRecord = allGoals().find((g) => g.id === goalId)!;
  } else {
    goalId = 10_000 + local.createdGoals.length;
    goalRecord = { id: goalId, userIndex: -1, title: preview.career_goal.title, context: preview.career_goal.context, createdAt, isFeatured: true };
    local = { ...local, createdGoals: [...local.createdGoals, goalRecord] };
  }

  const createdRoadmaps: BuiltRoadmap[] = preview.roadmaps.map((item, i) => {
    const roadmapId = 10_000 + local.createdRoadmaps.length + i;
    return {
      id: roadmapId,
      userIndex: -1,
      goalId,
      title: item.title,
      goalRawText,
      createdAt,
      milestones: item.milestones.map((m, mi) => ({
        id: 100_000 + roadmapId * 100 + mi,
        order_index: mi,
        title: m.title,
        description: m.description,
        detail: m.detail,
        due_date: m.due_date,
        is_completed_manual: false,
        completed_at: null,
        status: computeStatus(m.due_date, false),
        post: null,
      })),
      isFeatured: true,
    };
  });
  local = { ...local, createdRoadmaps: [...local.createdRoadmaps, ...createdRoadmaps] };
  saveLocalState(local);

  return createdRoadmaps.map((r) => ({
    id: r.id,
    user: toUserOut(VISITOR_USER),
    title: r.title,
    goal_raw_text: r.goalRawText,
    created_at: r.createdAt,
    progress_pct: 0,
    milestones: r.milestones,
    is_following: null,
    is_withered: false,
    major_goal_title: goalRecord.title,
  }));
}

// ---------- 정적 export용: 빌드 시점에 알려진 id 목록 ----------
// 방문자가 로컬에서 새로 만든 항목(id >= 10000)은 애초에 서버에 없어서
// 정적 페이지로 미리 만들 수 없다 — 그 페이지들은 클라이언트 렌더만으로
// 동작해야 하므로 각 [id]/page.tsx가 "찾을 수 없음"을 정상 처리해야 한다.
export const STATIC_GOAL_IDS: string[] = SEED_GOALS.map((_, i) => String(i + 1));
export const STATIC_ROADMAP_IDS: string[] = SEED_GOALS.map((_, i) => String(i + 1));
export const STATIC_USER_IDS: string[] = SEED_USERS.map((u) => String(u.id));
