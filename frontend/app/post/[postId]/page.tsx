"use client";

/*
 * 게시물 퍼머링크 - 공유 버튼이 만드는 /post/{postId} 착지 페이지(F-P3).
 * 비로그인 열람 가능, 없는 글은 PostDetail이 404 빈 상태를 렌더한다.
 * 작성자 줄은 상세가 ownerId를 알려준 뒤 프로필을 이어서 불러온다(1회).
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { PostDetail } from "@/components/PostDetail";
import { getProfile } from "@/lib/profiles-api";
import type { PostDto } from "@/lib/posts-api";

export default function PostPermalinkPage() {
  const params = useParams<{ postId: string }>();
  const postId = params.postId;

  const [owner, setOwner] = useState<{ uid: string; name: string; emoji: string } | null>(null);
  const ownerRequested = useRef(false);

  function handlePostChange(post: PostDto): void {
    if (ownerRequested.current) return;
    ownerRequested.current = true;
    getProfile(post.ownerId)
      .then((p) =>
        setOwner({ uid: post.ownerId, name: p.displayName ?? "관측자", emoji: p.avatarEmoji ?? "🔭" })
      )
      .catch(() => setOwner({ uid: post.ownerId, name: "관측자", emoji: "🔭" }));
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-6 md:py-12">
      {owner && (
        <Link
          href={`/profile/${owner.uid}`}
          className="mb-3.5 flex items-center gap-2.5 no-underline"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-rule bg-ink-800 text-lg">
            {owner.emoji}
          </span>
          <span className="font-sans text-body-sm font-semibold text-text-hi">{owner.name}</span>
        </Link>
      )}
      <PostDetail postId={postId} onPostChange={handlePostChange} />
    </div>
  );
}
