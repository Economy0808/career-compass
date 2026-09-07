import type { AuthUser, MeOut, UserProfileOut } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** 서버가 주는 상대 경로(이미지 등)를 절대 URL로 바꾼다. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  /** 403의 X-Auth-Requirement 응답 헤더 - "yonsei-verified"면 인증 유도, 없으면
   * 일반 권한 없음(소유권 위반 등). detail 문자열 매칭은 i18n·문구 변경에 깨지므로
   * 호출부는 반드시 이 필드로 분기한다(백엔드 app/auth/deps.py:require_yonsei_verified). */
  authRequirement?: string;
  /** 429의 X-Quota-Reason 응답 헤더 - "no-credit"이면 무료권·크레딧 소진이라
   * 플랜 안내를 띄운다. authRequirement와 같은 이유로 detail 문자열이 아니라
   * 이 필드로 분기한다(백엔드 constellation_intake 첫 /chat 게이트). */
  quotaReason?: string;
  /** 403의 X-Consent-Required 응답 헤더 - "overseas"면 국외이전 미동의라 인테이크
   * 진입 전 동의 모달을 띄운다. 서버가 미동의 데이터의 Anthropic 전송을 막는
   * 게이트(백엔드 require_overseas_consent). 클라 우회·경합 시의 폴백 신호다. */
  consentRequired?: string;

  constructor(
    status: number,
    detail: string,
    authRequirement?: string,
    quotaReason?: string,
    consentRequired?: string
  ) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.authRequirement = authRequirement;
    this.quotaReason = quotaReason;
    this.consentRequired = consentRequired;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Headers로 병합해야 jsonInit의 Content-Type이나 FormData(브라우저가 알아서
  // multipart Content-Type을 세팅) 케이스를 모두 안전하게 다룰 수 있다.
  const headers = new Headers(init?.headers);
  if (typeof window !== "undefined") {
    try {
      // 지연 import — 서버 번들(SSR/Workers)에서 firebase 초기화가 트리거되지 않도록 함
      const { getFirebaseAuth } = await import("./firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // Firebase 미초기화 환경에서는 토큰 없이 진행
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    // 세션 쿠키(HttpOnly) 전송 — 유저 식별은 전적으로 서버가 한다.
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let detail = `요청에 실패했어요 (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // JSON이 아닌 에러 응답은 기본 메시지 유지
    }
    throw new ApiError(
      res.status,
      detail,
      res.headers.get("X-Auth-Requirement") ?? undefined,
      res.headers.get("X-Quota-Reason") ?? undefined,
      res.headers.get("X-Consent-Required") ?? undefined
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------- auth ----------

export interface SignupInput {
  username: string;
  password: string;
  email: string;
  display_name: string;
  avatar_emoji: string;
  consent: boolean;
}

export function postSignup(input: SignupInput): Promise<{ detail: string }> {
  return request("/api/auth/signup", jsonInit("POST", input));
}

export function postVerifyEmail(email: string, code: string): Promise<{ detail: string }> {
  return request("/api/auth/verify-email", jsonInit("POST", { email, code }));
}

export function postLogin(username: string, password: string): Promise<MeOut> {
  return request("/api/auth/login", jsonInit("POST", { username, password }));
}

export function postLogout(): Promise<void> {
  return request("/api/auth/logout", { method: "POST" });
}

export function requestPasswordReset(email: string): Promise<{ detail: string }> {
  return request("/api/auth/password-reset/request", jsonInit("POST", { email }));
}

export function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string
): Promise<{ detail: string }> {
  return request(
    "/api/auth/password-reset/confirm",
    jsonInit("POST", { email, code, new_password: newPassword })
  );
}

export function deleteAccount(password: string): Promise<void> {
  return request<void>("/api/auth/delete-account", jsonInit("POST", { password }));
}

export function getMe(): Promise<MeOut> {
  return request("/api/auth/me");
}

/** Firebase 로그인 직후 서버와 동기화하고, 서버가 판단한 최신 인증 상태를 받는다. */
export function postAuthSync(input?: {
  displayName?: string;
  avatarEmoji?: string;
  consent?: boolean;
}): Promise<AuthUser> {
  return request("/api/auth/sync", jsonInit("POST", input ?? {}));
}

/** 가입 직후 온보딩 - 학번·학과·관심사·동의를 저장한다(백엔드 계약 03-code-78,
 * 2026-09-03 확정). 프로필 저장은 auth/sync가 아니라 이 전용 엔드포인트로 간다
 * (get_current_user 필수 - createUserWithEmailAndPassword 직후 토큰이 살아 있어
 * 가입 흐름에서 바로 호출 가능).
 *
 * 동의는 service(필수 true, false면 서버가 422)·marketing(선택). 국외이전
 * (overseas) 동의는 여기 없다 - 온보딩 데이터(학번·학과·careerText)는 국내
 * (Vertex 서울)에만 저장되고 Anthropic으로 가지 않으므로, 국외이전 동의는 실제
 * 이전이 일어나는 인테이크 대화 진입 시점에서 따로 받는다(사용자 결정 2026-09-04).
 * 민감정보 별도동의(sensitive)도 두지 않는다 - careerText에 인라인 경고로
 * 최소화(개인정보보호법 16·23조, 보안 세션 70 결론). 학번 저장형태(해시 등)는
 * 백엔드 내부 소관 - 프론트는 10자리 문자열로 보내면 된다. */
export interface ProfileOnboardingInput {
  studentId: string;
  department: string;
  doubleMajor?: string;
  grade: number;
  declaredTags: string[];
  careerText?: string;
  consents: {
    service: boolean;
    marketing?: boolean;
  };
}

export function postProfileOnboarding(
  input: ProfileOnboardingInput
): Promise<{ onboardingComplete: boolean }> {
  return request("/api/profiles/onboarding", jsonInit("POST", input));
}

/** 온보딩(프로필) 완료 여부 - 로그인 후 미완이면 /onboarding으로 되돌리기 위한
 * 신호(백엔드 03-code-78, GET /api/profiles/me/onboarding). user_private 문서
 * 존재 여부로 판정. department는 온보딩에서 저장한 학과 - 학회/동아리 등
 * 학과 드롭다운이 있는 화면에서 초기 선택값으로 재사용한다(값이 taxonomy
 * 목록에 없으면 호출부가 무시하고 기존 동작으로 폴백). */
export function getOnboardingStatus(): Promise<{ onboardingComplete: boolean; department?: string }> {
  return request("/api/profiles/me/onboarding");
}

// ---------- 국외이전 동의 (인테이크 AI 기능) ----------

/** 국외이전 동의 문구 판본. 백엔드 CURRENT_OVERSEAS_CONSENT_VERSION과 반드시
 * 일치시킨다 - 서버가 저장 판본과 이 값을 비교해 동의 유효성을 판정한다(판본이
 * 다르면 POST가 422). 법적 본문(모달)을 고치면 백엔드 상수와 함께 이 값을 올린다.
 * 그러면 구 판본 동의는 무효가 되어 유저가 재동의한다. */
export const OVERSEAS_CONSENT_VERSION = "2026-09-04-v1";

/** 현재 유저가 현행 판본으로 국외이전에 동의했는지 - 인테이크 진입 전 조회.
 * consented=false면 동의 모달을 띄운다(백엔드 03-code-78). */
export function getOverseasConsent(): Promise<{ consented: boolean; currentVersion: string }> {
  return request("/api/consents/overseas");
}

/** 국외이전 동의 기록 - user_private에 uid+시각+판본 저장. 판본이 현행과 다르면
 * 서버가 422(stale 동의 거부). */
export function postOverseasConsent(version: string): Promise<void> {
  return request("/api/consents/overseas", jsonInit("POST", { version }));
}

// ---------- 학회/동아리 크라우드소싱 디렉터리 (지원요소 실DB grounding §1) ----------
// 인테이크가 LLM으로 지어내던 학회 정보를, 연세 인증 유저가 직접 제보한 실데이터로
// 대체한다(백엔드 03-code-78/a5 계약). 스크래핑 금지(Hard Rule) - 유저 동의 제보만.
// 보안 경계(보안 세션): 담당자 연락처는 수집하지 않는다(폼에 필드 없음), official_url은
// https만(서버가 http/mailto/IP/user:pass@ → 422), 목록 링크는 safeLinkHref로만 렌더.
//
// 2026-09-07 department_id -> category 전환(사용자 지시: 학회 분류가 수업 taxonomy의
// 학과 목록과 뒤섞여 있던 걸 학회 전용 분야로 분리). SOCIETY_CATEGORIES는 백엔드
// app/schemas/societies.py의 SocietyCategory Literal과 순서까지 정확히 일치시킨다.

export type SocietyKind = "학회" | "동아리";

/** 학회 전용 분야 목록(순서 유지) - 백엔드 SocietyCategory와 반드시 일치. */
export const SOCIETY_CATEGORIES = [
  "학술·연구",
  "금융·투자",
  "경영·컨설팅",
  "개발·IT",
  "데이터·AI",
  "창업·벤처",
  "마케팅·광고",
  "공연·예술",
  "체육·스포츠",
  "봉사·사회공헌",
  "언론·미디어",
  "어학·국제교류",
  "취미·교양",
] as const;

export type SocietyCategory = (typeof SOCIETY_CATEGORIES)[number];

/** 승인된 학회/동아리 - GET 응답(제보자 uid 미포함). */
export interface SocietyOut {
  id: string;
  category: SocietyCategory;
  name: string;
  kind: SocietyKind;
  // 백엔드는 _CamelModel이라 camelCase로 응답한다 - snake_case로 읽으면 undefined가
  // 되어 safeLinkHref(undefined)에서 크래시한다(학회 0건일 땐 카드가 안 그려져 잠복,
  // 데이터가 쌓이자 터졌다 - 2026-09-07).
  officialUrl: string;
  recruitSeason?: string;
  field?: string;
  description?: string;
}

/** 제보 입력 - 연락처란 없음(설계상 부재). */
export interface SocietySubmitInput {
  category: SocietyCategory;
  name: string;
  kind: SocietyKind;
  official_url: string;
  recruit_season?: string;
  field?: string;
  description?: string;
}

/** 분야별 승인된 학회/동아리 조회 - 인증 불필요, approved만 반환. */
export function getSocieties(category: SocietyCategory): Promise<SocietyOut[]> {
  return request(`/api/societies?category=${encodeURIComponent(category)}`);
}

/** 학회/동아리 제보 - 연세 인증 필수. 201 {id, moderation_status:"pending"}.
 * 422 PII(연락처 감지)·422 URL(비https)·401·403·429는 ApiError로 온다. */
export function submitSociety(
  input: SocietySubmitInput
): Promise<{ id: string; moderation_status: string }> {
  return request("/api/societies", jsonInit("POST", input));
}

// ---------- 자격증 검색 + 제보 (지원요소 실DB grounding) ----------
// 인테이크가 LLM으로 지어내던 자격증 정보를, 큐레이션(Q-Net 등 공식 원천) 자격증 +
// 연세 인증 유저 제보로 대체한다(백엔드 app/api/certifications.py 계약, 학회/동아리와
// 같은 신뢰 체계). GET은 인증 불요(공개 열람 - 자격증 마스터는 공공 데이터).
// 보안 경계: 연락처 필드 없음, official_url은 safeLinkHref로만 렌더(호출부 책임),
// 유저 제보는 승인돼도 verified=true로 격상되지 않는다(하드 요구사항).

/** GET /api/certifications 응답 항목 - 큐레이션/공식과 유저 제보가 병합된 결과.
 *
 * id는 백엔드 app/schemas/certifications.py의 CertificationOut에 필드 자체가
 * 없다(직접 확인함) - user_certification_repo.list_approved()도 Firestore
 * 문서 id를 응답에 안 채운다. 즉 지금 이 엔드포인트로는 유저 제보 항목을 신고할
 * 방법이 없다(백엔드 쪽 계약 공백 - 별도로 플래그함). id를 optional로 남겨두어
 * 백엔드가 나중에 채워주면 그대로 동작하게 하고, 프론트는 id가 있을 때만
 * 신고 버튼을 노출한다. */
export interface CertificationOut {
  jmcd: string;
  name: string;
  nameNorm: string;
  issuer: string;
  scope: string;
  certClass: string;
  tier: string;
  officialUrl: string;
  schedule: Record<string, string> | null;
  sourceType: string;
  verified: boolean;
  id?: string;
}

/** career_paths 문서 안의 자격증 참조 - name/tier/certId만 있고 CertificationOut
 * 전체가 아니다(백엔드 app/schemas/certifications.py CareerCertRefOut). */
export interface CareerCertRefOut {
  name: string;
  tier: string;
  certId: string;
}

/** GET /api/certifications/by-career 응답 - CertificationOut이 아니라
 * CareerPathOut(진로명 + 자격증 참조 목록)이다. */
export interface CareerPathOut {
  name: string;
  certs: CareerCertRefOut[];
}

/** 자격증 검색 - q(이름 부분일치)/scope 둘 다 선택이며, 둘 다 비면 전체 목록. */
export function getCertifications(q: string, scope?: string): Promise<CertificationOut[]> {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (scope) qs.set("scope", scope);
  const suffix = qs.toString();
  return request(`/api/certifications${suffix ? `?${suffix}` : ""}`);
}

/** 진로명으로 관련 자격증 참조 목록을 조회한다. 404면 해당 진로 데이터가 없다는 뜻. */
export function getCertificationsByCareer(career: string): Promise<CareerPathOut> {
  return request(`/api/certifications/by-career?career=${encodeURIComponent(career)}`);
}

export interface CertificationSubmitInput {
  name: string;
  issuer: string;
  officialUrl: string;
}

/** 자격증 제보 - 연세 인증 필수. 201 {id, moderationStatus:"pending"}.
 * 409 이름 중복(큐레이션과 충돌)·422 PII/URL·401·403·429는 ApiError로 온다. */
export function submitCertification(
  input: CertificationSubmitInput
): Promise<{ id: string; moderationStatus: string }> {
  return request("/api/certifications", jsonInit("POST", input));
}

/** 유저 제보 자격증 신고 - 큐레이션/공식 자격증이면 400, 없으면 404. */
export function reportCertification(id: string): Promise<{ status: string }> {
  return request(`/api/certifications/${encodeURIComponent(id)}/report`, { method: "POST" });
}

export function postSchoolEmailRequest(email: string): Promise<{ detail: string }> {
  return request("/api/auth/school-email/request", jsonInit("POST", { email }));
}

export function postSchoolEmailVerify(code: string): Promise<{ detail: string }> {
  return request("/api/auth/school-email/verify", jsonInit("POST", { code }));
}

export function postStudentCard(file: File): Promise<{ detail: string }> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/auth/student-card", { method: "POST", body: form });
}

// ---------- profile / follow ----------

export function getUserProfile(userId: number): Promise<UserProfileOut> {
  return request<UserProfileOut>(`/api/users/${userId}`);
}

export function patchMyBio(bio: string): Promise<UserProfileOut> {
  return request<UserProfileOut>("/api/users/me", jsonInit("PATCH", { bio }));
}

export function followUser(userId: number): Promise<void> {
  return request<void>(`/api/users/${userId}/follow`, { method: "POST" });
}

export function unfollowUser(userId: number): Promise<void> {
  return request<void>(`/api/users/${userId}/follow`, { method: "DELETE" });
}
