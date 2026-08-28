"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { MiniConstellation } from "@/components/MiniConstellation";
import { listUserConstellations, type ConstellationDto } from "@/lib/constellation-api";
import { useAuth } from "@/lib/auth-context";
import { DangerZone } from "./_components/DangerZone";

/** 로딩 중 보여줄 스켈레톤 타일 개수. 실제 그리드 개수와 무관 - 그냥 화면을 채울 만큼. */
const SKELETON_TILES = 9;

function ProfileGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-hidden>
      {Array.from({ length: SKELETON_TILES }).map((_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-lg border border-rule bg-ink-800/70"
        />
      ))}
    </div>
  );
}

/** 프로필 그리드의 별자리 타일 - FeedCard와 같은 카드 크롬(테두리/배경)에
 * MiniConstellation을 정사각형으로 얹는다. "누르면 확대되면서 본다"는 지시는
 * hover 시 살짝 커지는 1개 트랜지션(scale)로 표현한다 - 클릭 후 라우팅을
 * 지연시켜 별도 확대 애니메이션을 타는 방식은 상태/타이머가 늘어나는 과잉
 * 연출이라 택하지 않았다. prefers-reduced-motion은 전역 규칙이 처리한다. */
function ConstellationTile({ item }: { item: ConstellationDto }) {
  return (
    <Link
      href={`/constellation/${item.id}`}
      className="group block overflow-hidden rounded-lg border border-rule bg-ink-800/70 no-underline transition-transform duration-150 hover:scale-[1.03] hover:bg-ink-800/90"
    >
      <div className="relative aspect-square overflow-hidden bg-ink-900">
        <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
        <MiniConstellation
          nodes={item.nodes}
          edges={item.edges}
          className="absolute inset-0 h-full w-full p-3"
        />
      </div>
      <p className="truncate px-2.5 py-2 text-caption text-text-lo">{item.title}</p>
    </Link>
  );
}

export default function ProfilePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isOwn = !authLoading && user?.uid === params.id;

  const [items, setItems] = useState<ConstellationDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    listUserConstellations(params.id)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        // 에러도 빈 상태로 취급한다 - 프로필 페이지에 별도 에러 UI를 두지 않는다.
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // 이름/아바타: B2(팔로우·유저 조회 API 이관)까지는 타인의 displayName/아바타를
  // 가져올 방법이 없다 - 구 FastAPI(/api/users)는 숫자 PK 기반이라 Firebase uid로
  // 조회할 수 없고, 여기서 새로 추가하지도 않는다. 내 프로필이면 auth 상태에서
  // 채우고, 타인은 피드 카드와 같은 자리표시("이름 없는 관측자" + 기본 이모지)로
  // 둔다.
  const displayName = isOwn ? user?.displayName ?? "이름 없는 관측자" : "이름 없는 관측자";
  const avatarEmoji = isOwn ? user?.avatarEmoji ?? "🔭" : "🔭";

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-lit/45 bg-ink-900 text-title shadow-glow-bloom">
          {avatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-title font-bold text-text-hi">{displayName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-lo">
            <span>
              별자리 <b className="text-text-lo">{items?.length ?? "–"}</b>
            </span>
            {/* 팔로워/팔로잉: B2(팔로우 API 이관) 전까지 실값이 없어 흐리게 자리만
                잡아둔다. */}
            <span className="text-text-lo/50">팔로워 –</span>
            <span className="text-text-lo/50">팔로잉 –</span>
          </div>
        </div>
        {!isOwn && (
          // 팔로우 버튼: UI만 - B2에서 팔로우 API가 붙기 전까지 클릭해도 아무
          // 동작도 하지 않는다.
          <Button variant="ghost" size="sm" onClick={() => {}}>
            팔로우
          </Button>
        )}
      </div>

      <div className="mt-9">
        {items === null ? (
          <ProfileGridSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 띄운 별자리가 없어요"
            description={isOwn ? "'별자리 생성하기'에서 첫 별자리를 만들어보세요." : undefined}
            action={
              isOwn ? (
                <Link
                  href="/constellation/new"
                  className="rounded-md border border-transparent bg-spec-b px-5 py-2.5 text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
                >
                  별자리 생성하러 가기
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {items.map((item) => (
              <ConstellationTile key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {isOwn && <DangerZone onDeleted={() => router.push("/")} />}
    </>
  );
}
