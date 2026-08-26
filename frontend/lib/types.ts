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
  follower_count: number;
  following_count: number;
  is_following: boolean | null;
}

// ---------- todos (일정) ----------

export type TodoColor = "green" | "sky" | "gold" | "coral" | "violet" | "brown";

export interface TodoCategoryOut {
  id: number;
  name: string;
  color: TodoColor;
  order_index: number;
}

export interface TodoItemOut {
  id: number;
  category_id: number;
  content: string;
  is_completed: boolean;
  order_index: number;
}

export interface TodoDayOut {
  categories: TodoCategoryOut[];
  items: TodoItemOut[];
}

export interface CalendarDayOut {
  date: string;
  completed_count: number;
  total_count: number;
}
