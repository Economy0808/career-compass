import type {
  ChatMessageIn,
  ChatResponse,
  FeedScope,
  MilestonePatchResponse,
  RoadmapCardOut,
  RoadmapDetailOut,
  UserOut,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed with ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function getUsers(): Promise<UserOut[]> {
  return request<UserOut[]>("/api/users");
}

export function getFeed(options: {
  viewerId?: number;
  scope?: FeedScope;
  limit?: number;
  offset?: number;
}): Promise<RoadmapCardOut[]> {
  const params = new URLSearchParams();
  if (options.viewerId !== undefined) params.set("viewer_id", String(options.viewerId));
  if (options.scope) params.set("scope", options.scope);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  const qs = params.toString();
  return request<RoadmapCardOut[]>(`/api/roadmap/feed${qs ? `?${qs}` : ""}`);
}

export function getRoadmap(id: number, viewerId?: number): Promise<RoadmapDetailOut> {
  const qs = viewerId !== undefined ? `?viewer_id=${viewerId}` : "";
  return request<RoadmapDetailOut>(`/api/roadmap/${id}${qs}`);
}

export function postChat(
  goalRawText: string,
  messages: ChatMessageIn[]
): Promise<ChatResponse> {
  return request<ChatResponse>("/api/roadmap/chat", {
    method: "POST",
    body: JSON.stringify({ goal_raw_text: goalRawText, messages }),
  });
}

export function postGenerate(
  userId: number,
  goalRawText: string,
  messages: ChatMessageIn[]
): Promise<RoadmapDetailOut> {
  return request<RoadmapDetailOut>("/api/roadmap/generate", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, goal_raw_text: goalRawText, messages }),
  });
}

export function patchMilestone(
  milestoneId: number,
  isCompleted: boolean
): Promise<MilestonePatchResponse> {
  return request<MilestonePatchResponse>(`/api/roadmap/milestones/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify({ is_completed: isCompleted }),
  });
}

export function followUser(userId: number, followerId: number): Promise<void> {
  return request<void>(`/api/users/${userId}/follow`, {
    method: "POST",
    body: JSON.stringify({ follower_id: followerId }),
  });
}

export function unfollowUser(userId: number, followerId: number): Promise<void> {
  return request<void>(`/api/users/${userId}/follow`, {
    method: "DELETE",
    body: JSON.stringify({ follower_id: followerId }),
  });
}
