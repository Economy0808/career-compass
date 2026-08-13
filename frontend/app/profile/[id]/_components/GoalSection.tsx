"use client";

import { useRouter } from "next/navigation";
import { MiniBeanstalk } from "@/components/MiniBeanstalk";
import { Button, Card, EmptyState, TargetIcon, WitherIcon } from "@/components/ui";
import type { RoadmapCardOut } from "@/lib/types";

interface GoalGroup {
  title: string | null;
  items: RoadmapCardOut[];
  showHeader: boolean;
}

/** 활성 콩나무를 대목표별로 묶는다. 전부 미분류(레거시)면 헤더 없는 플랫 그리드 유지. */
function groupByMajorGoal(cards: RoadmapCardOut[]): GoalGroup[] {
  const groups: GoalGroup[] = [];
  for (const card of cards) {
    const found = groups.find((g) => g.title === card.major_goal_title);
    if (found) found.items.push(card);
    else groups.push({ title: card.major_goal_title, items: [card], showHeader: false });
  }
  const hasNamed = groups.some((g) => g.title !== null);
  if (!hasNamed) return groups;
  groups.sort((a, b) => Number(a.title === null) - Number(b.title === null));
  return groups.map((g) => ({ ...g, showHeader: true }));
}

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

export interface GoalSectionProps {
  cards: RoadmapCardOut[];
  isMe: boolean;
  displayName: string;
  featurePendingId: number | null;
  goalFeaturePendingId: number | null;
  beanDeleteCost: number;
  onToggleFeatured: (card: RoadmapCardOut) => void;
  onToggleGoalFeatured: (goalId: number, current: boolean) => void;
  onRequestDelete: (card: RoadmapCardOut) => void;
}

export function GoalSection({
  cards,
  isMe,
  displayName,
  featurePendingId,
  goalFeaturePendingId,
  beanDeleteCost,
  onToggleFeatured,
  onToggleGoalFeatured,
  onRequestDelete,
}: GoalSectionProps) {
  const router = useRouter();
  const withered = cards.filter((c) => c.is_withered);

  const doneCount = (card: RoadmapCardOut) =>
    Math.round((card.progress_pct / 100) * card.milestone_count);

  return (
    <>
      <div className="mb-4 mt-9 flex items-center gap-3">
        <h2 className="font-serif text-heading font-bold text-content-primary">
          {isMe ? "내 콩나무들" : `${displayName}의 콩나무들`}
        </h2>
        {isMe && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => router.push("/new")}
          >
            새 씨앗 심기
          </Button>
        )}
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title={isMe ? "아직 심은 씨앗이 없어요." : "아직 심은 콩나무가 없어요."}
          description={isMe ? "첫 콩나무를 심어보세요." : undefined}
        />
      ) : (
        groupByMajorGoal(cards.filter((c) => !c.is_withered)).map((group) => (
          <div key={group.title ?? "__ungrouped__"} className="mb-6">
            {group.showHeader && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="flex min-w-0 items-center gap-1.5 font-serif text-body font-bold text-bloom">
                  {group.title && <TargetIcon size={16} className="shrink-0" />}
                  <span className="break-words">{group.title ?? "그 외 콩나무"}</span>
                </h3>
                <span className="text-caption text-content-muted">{group.items.length}그루</span>
                {isMe && group.title !== null && group.items[0].major_goal_id !== null && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-caption text-content-muted">
                    <input
                      type="checkbox"
                      checked={group.items[0].major_goal_featured ?? true}
                      disabled={goalFeaturePendingId === group.items[0].major_goal_id}
                      onChange={() =>
                        onToggleGoalFeatured(
                          group.items[0].major_goal_id as number,
                          group.items[0].major_goal_featured ?? true
                        )
                      }
                      className="accent-growth"
                    />
                    메인에 띄우기 (로드맵 숲 노출)
                  </label>
                )}
              </div>
            )}
            <div className={GRID}>
              {group.items.map((card) => (
                <Card key={card.id} interactive onClick={() => router.push(`/roadmap/${card.id}`)}>
                  <div className="flex justify-center">
                    <MiniBeanstalk progressPct={card.progress_pct} />
                  </div>
                  <div className="mt-1.5 break-words text-body font-bold leading-[1.4] text-content-primary">
                    {card.title}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-caption text-content-muted">
                      마일스톤 {doneCount(card)}/{card.milestone_count}
                    </span>
                    <span className="ml-auto text-caption font-semibold text-growth-bright">
                      {card.progress_pct}% 자람
                    </span>
                  </div>
                  {/* 숲 노출은 대목표 단위 — 개별 체크박스는 레거시(미분류) 카드에만 */}
                  {isMe && card.major_goal_id === null && (
                    <div className="mt-3 border-t border-line pt-3">
                      <label
                        onClick={(e) => e.stopPropagation()}
                        className="flex cursor-pointer items-center gap-2 text-caption text-content-muted"
                      >
                        <input
                          type="checkbox"
                          checked={card.is_featured}
                          disabled={featurePendingId === card.id}
                          onChange={() => onToggleFeatured(card)}
                          className="accent-growth"
                        />
                        메인에 띄우기 (로드맵 숲 노출)
                      </label>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {/* 시들어버린 콩나무들 - 마감 +30일 지나도 미완주 */}
      {withered.length > 0 && (
        <>
          <div className="mb-4 mt-10 flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-1.5 font-serif text-heading font-bold text-wither">
              <WitherIcon size={18} className="shrink-0" />
              시들어버린 콩나무들
            </h2>
            <span className="text-caption text-content-muted">
              마감이 한 달 넘게 지났어요 — 지금이라도 완주하면 되살아나요
            </span>
          </div>
          <div className={GRID}>
            {withered.map((card) => (
              <Card
                key={card.id}
                interactive
                onClick={() => router.push(`/roadmap/${card.id}`)}
                className="border-wither/30 hover:border-wither/55"
              >
                <div className="flex justify-center">
                  <MiniBeanstalk progressPct={card.progress_pct} isWithered />
                </div>
                <div className="mt-1.5 flex items-start gap-1.5 text-body font-bold leading-[1.4] text-wither">
                  <WitherIcon size={16} className="mt-1 shrink-0" />
                  <span className="min-w-0 break-words">{card.title}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-caption text-content-muted">
                    마일스톤 {doneCount(card)}/{card.milestone_count}
                  </span>
                  <span className="ml-auto text-caption font-semibold text-wither">
                    {card.progress_pct}%에서 시듦
                  </span>
                </div>
                {isMe && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-wither/30 pt-3">
                    <span className="text-micro text-content-muted">물을 주거나, 정리하거나</span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDelete(card);
                      }}
                    >
                      콩 {beanDeleteCost}개로 정리
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
