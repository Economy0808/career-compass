export type ChatRole = "user" | "assistant";
export type MilestoneStatus = "완료" | "기한초과" | "진행중";
export type FeedScope = "all" | "following";

export interface UserOut {
  id: number;
  display_name: string;
  avatar_emoji: string;
}

export interface ChatMessageIn {
  role: ChatRole;
  content: string;
}

export interface ChatResponse {
  done: boolean;
  question: string | null;
  messages: ChatMessageIn[];
}

export interface MilestoneOut {
  id: number;
  order_index: number;
  title: string;
  description: string;
  due_date: string;
  is_completed_manual: boolean;
  completed_at: string | null;
  status: MilestoneStatus;
}

export interface RoadmapDetailOut {
  id: number;
  user: UserOut;
  title: string;
  goal_raw_text: string;
  created_at: string;
  progress_pct: number;
  milestones: MilestoneOut[];
  is_following: boolean | null;
}

export interface RoadmapCardOut {
  id: number;
  user: UserOut;
  title: string;
  progress_pct: number;
  milestone_count: number;
  created_at: string;
  is_following: boolean | null;
}

export interface MilestonePatchResponse {
  milestone: MilestoneOut;
  roadmap_id: number;
  roadmap_progress_pct: number;
}
