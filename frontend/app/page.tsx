"use client";

import { EmptyState } from "@/components/ui";
import { TelescopeLanding } from "@/components/TelescopeLanding";
import { useAuth } from "@/lib/auth-context";

// 비로그인 방문자에게는 망원경 랜딩(밝은 종이 성도)을, 로그인 사용자에게는
// 소셜 피드 자리를 보여준다.
// TODO(placeholder): 별자리 피드는 아직 없다. 예전 "로드맵 숲" 피드(콩나무 기반)는
// 통째로 삭제됐고, 이 자리는 별자리 소셜 피드가 붙기 전까지의 임시 화면이다.
export default function FeedPage() {
  const { user, loading } = useAuth();

  if (!loading && !user) return <TelescopeLanding />;

  return (
    <div className="mx-auto max-w-sm py-16">
      <EmptyState
        title="별자리 피드, 준비 중이에요"
        description="친구들이 만든 별자리를 둘러보는 소셜 피드는 곧 찾아와요. 지금은 오른쪽 위 '별자리 생성하기'에서 나만의 별자리를 먼저 만들어보세요."
      />
    </div>
  );
}
