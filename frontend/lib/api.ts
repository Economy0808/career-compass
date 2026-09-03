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

  constructor(status: number, detail: string, authRequirement?: string, quotaReason?: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.authRequirement = authRequirement;
    this.quotaReason = quotaReason;
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
      res.headers.get("X-Quota-Reason") ?? undefined
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
 * 존재 여부로 판정. */
export function getOnboardingStatus(): Promise<{ onboardingComplete: boolean }> {
  return request("/api/profiles/me/onboarding");
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
