import type {
  CalendarDayOut,
  MeOut,
  TodoCategoryOut,
  TodoColor,
  TodoDayOut,
  TodoItemOut,
  UserProfileOut,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** 서버가 주는 상대 경로(이미지 등)를 절대 URL로 바꾼다. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    // 세션 쿠키(HttpOnly) 전송 — 유저 식별은 전적으로 서버가 한다.
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    let detail = `요청에 실패했어요 (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // JSON이 아닌 에러 응답은 기본 메시지 유지
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
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

// ---------- todos (일정) ----------

export function getTodoDay(date: string): Promise<TodoDayOut> {
  return request<TodoDayOut>(`/api/todos/day?date=${date}`);
}

export function getTodoCalendar(year: number, month: number): Promise<CalendarDayOut[]> {
  return request<CalendarDayOut[]>(`/api/todos/calendar?year=${year}&month=${month}`);
}

export function createTodoCategory(name: string, color: TodoColor): Promise<TodoCategoryOut> {
  return request<TodoCategoryOut>("/api/todos/categories", jsonInit("POST", { name, color }));
}

export function patchTodoCategory(
  id: number,
  patch: { name?: string; color?: TodoColor; order_index?: number }
): Promise<TodoCategoryOut> {
  return request<TodoCategoryOut>(`/api/todos/categories/${id}`, jsonInit("PATCH", patch));
}

export function deleteTodoCategory(id: number): Promise<void> {
  return request<void>(`/api/todos/categories/${id}`, { method: "DELETE" });
}

export function createTodoItem(
  categoryId: number,
  dueDate: string,
  content: string
): Promise<TodoItemOut> {
  return request<TodoItemOut>(
    "/api/todos/items",
    jsonInit("POST", { category_id: categoryId, due_date: dueDate, content })
  );
}

export function patchTodoItem(
  id: number,
  patch: { content?: string; is_completed?: boolean; order_index?: number }
): Promise<TodoItemOut> {
  return request<TodoItemOut>(`/api/todos/items/${id}`, jsonInit("PATCH", patch));
}

export function deleteTodoItem(id: number): Promise<void> {
  return request<void>(`/api/todos/items/${id}`, { method: "DELETE" });
}
