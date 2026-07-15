export type ChatRole = "user" | "assistant";
export type MilestoneStatus = "완료" | "기한초과" | "진행중";
export type FeedScope = "all" | "following";

export interface UserOut {
  id: number;
  display_name: string;
  avatar_emoji: string;
}

export type CardStatus = "pending" | "approved" | "rejected";

export interface MeOut {
  id: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  email: string;
  bio: string | null;
  email_verified: boolean;
  yonsei_verified: boolean;
  verification_method: "school_email" | "student_card" | null;
  card_status: CardStatus | null;
}

export interface UserProfileOut {
  id: number;
  display_name: string;
  avatar_emoji: string;
  bio: string | null;
  yonsei_verified: boolean;
  roadmap_count: number;
  follower_count: number;
  following_count: number;
  is_following: boolean | null;
  bean_balance: number;
}

export interface BeanRankingEntry {
  rank: number;
  user: UserOut;
  beans_earned: number;
}

export type BeanPackageId = "bean_10" | "bean_55" | "bean_120";

export interface BeanPurchaseResponse {
  detail: string;
  bean_balance: number;
  receipt_id: string;
}

export interface MilestonePostOut {
  caption: string;
  body: string | null;
  has_image: boolean;
  image_url: string | null;
  updated_at: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
}

export interface CommentOut {
  id: number;
  user: UserOut;
  content: string;
  created_at: string;
  can_delete: boolean;
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
  post: MilestonePostOut | null;
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
  is_withered: boolean;
}

export interface RoadmapCardOut {
  id: number;
  user: UserOut;
  title: string;
  progress_pct: number;
  milestone_count: number;
  created_at: string;
  is_following: boolean | null;
  is_featured: boolean;
  is_withered: boolean;
}

export interface MilestonePatchResponse {
  milestone: MilestoneOut;
  roadmap_id: number;
  roadmap_progress_pct: number;
  beans_awarded: number | null;
}
