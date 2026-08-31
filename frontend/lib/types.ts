export interface UserOut {
  id: number;
  display_name: string;
  avatar_emoji: string;
}

/** Firebase 인증 + /api/auth/sync 응답을 합친 클라이언트 인증 상태. */
export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  yonseiVerified: boolean;
  displayName: string | null;
  avatarEmoji: string | null;
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

