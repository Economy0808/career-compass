/**
 * 층형(rank) 레이아웃의 가독성 보조 - 순수 함수 2개.
 *
 * 사용자 지시 "노드가 너무 어지러움. 배치랑 노드 연결을 좀 안 어지럽게 하는
 * 방식을 강구해봐"에 대한 답: 층은 이미 최장경로 rank로 잡혀 있으니(시안
 * DraftReviewStage.interiorLayoutFor / 메인캔버스 ConstellationCanvas.
 * computeDiveLayout), 남은 어지러움의 두 근원을 여기서 잡는다.
 *
 * 1. orderRanksByBarycenter - 층 안에서의 좌우 순서가 원본 배열 순서 그대로라
 *    간선이 화면 전폭을 교차하던 문제. Sugiyama식 barycenter 휴리스틱:
 *    이웃(부모/자식)의 평균 가로 위치로 층 내 순서를 위->아래, 아래->위로
 *    몇 차례 쓸어내리며 정렬한다. 완전 최소화가 아니라 휴리스틱이지만
 *    이 규모(성운당 수십 노드)에는 충분하다.
 * 2. redundantEdgeKeys - A→B→C가 있는데 A→C 직행 간선까지 그리면 위계가
 *    사다리가 아니라 그물로 읽힌다. 더 긴 경로가 존재하는 직행 간선(추이적
 *    중복)을 골라낸다 - 그리기 생략용이지 데이터 삭제용이 아니다.
 *
 * 두 함수 모두 순환이 섞여 들어와도 절대 멈추지 않는다(방문 집합으로 종료
 * 보장) - 백엔드가 DAG를 약속하지만 UI는 방어적으로.
 */

const BARYCENTER_SWEEPS = 4;

/** parentsOf: 자식 id -> 부모 id 목록(같은 집합 안의 것만 유효로 친다).
 * 반환: rank -> 정렬된 id 배열. 이웃이 하나도 없는 노드는 제자리를 지킨다
 * (barycenter를 못 구하니 흔들 이유가 없다). */
export function orderRanksByBarycenter(
  ids: string[],
  rankOf: Map<string, number>,
  parentsOf: Map<string, string[]>,
  sweeps: number = BARYCENTER_SWEEPS
): Map<number, string[]> {
  const idSet = new Set(ids);
  const childrenOf = new Map<string, string[]>();
  for (const id of ids) childrenOf.set(id, []);
  parentsOf.forEach((parents, child) => {
    if (!idSet.has(child)) return;
    for (const p of parents) {
      if (idSet.has(p) && p !== child) childrenOf.get(p)!.push(child);
    }
  });

  // 초기 순서 = ids 순서(안정적) 그대로 rank별로 묶는다.
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rankOf.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }
  const rankKeys = Array.from(byRank.keys()).sort((a, b) => a - b);

  // 층 내 인덱스(가로 위치의 대리값). 정렬할 때마다 갱신한다.
  const pos = new Map<string, number>();
  const refreshPos = () => {
    byRank.forEach((rowIds) => rowIds.forEach((id, i) => pos.set(id, i)));
  };
  refreshPos();

  const sortRowBy = (rowIds: string[], neighborsOf: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    for (const id of rowIds) {
      const neighbors = (neighborsOf.get(id) ?? []).filter((n) => idSet.has(n));
      if (neighbors.length === 0) {
        bary.set(id, pos.get(id) ?? 0); // 이웃 없음 - 제자리 유지
      } else {
        bary.set(id, neighbors.reduce((s, n) => s + (pos.get(n) ?? 0), 0) / neighbors.length);
      }
    }
    rowIds.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0) || (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
  };

  for (let s = 0; s < sweeps; s++) {
    // 위에서 아래로: 부모 위치 기준.
    for (const r of rankKeys) {
      sortRowBy(byRank.get(r)!, parentsOf);
      refreshPos();
    }
    // 아래에서 위로: 자식 위치 기준.
    for (let i = rankKeys.length - 1; i >= 0; i--) {
      sortRowBy(byRank.get(rankKeys[i])!, childrenOf);
      refreshPos();
    }
  }
  return byRank;
}

/** 직행 간선 "부모->자식" 중 다른 경로(길이 2 이상)로도 닿는 것의 키 집합.
 * 키 형식은 `${parentId}->${childId}`. 판정: 부모의 다른 자식에서 출발해
 * 해당 자식에 닿을 수 있으면 그 직행선은 중복이다. */
export function redundantEdgeKeys(ids: string[], parentsOf: Map<string, string[]>): Set<string> {
  const idSet = new Set(ids);
  const childrenOf = new Map<string, string[]>();
  for (const id of ids) childrenOf.set(id, []);
  parentsOf.forEach((parents, child) => {
    if (!idSet.has(child)) return;
    for (const p of parents) {
      if (idSet.has(p) && p !== child) childrenOf.get(p)!.push(child);
    }
  });

  // 후손 집합 메모(방문 집합으로 순환 종료 보장).
  const descendantsMemo = new Map<string, Set<string>>();
  const descendantsOf = (id: string): Set<string> => {
    const cached = descendantsMemo.get(id);
    if (cached) return cached;
    const acc = new Set<string>();
    descendantsMemo.set(id, acc); // 순환 시 부분 집합으로 종료
    for (const c of childrenOf.get(id) ?? []) {
      if (acc.has(c)) continue;
      acc.add(c);
      descendantsOf(c).forEach((d) => acc.add(d));
    }
    return acc;
  };

  const redundant = new Set<string>();
  childrenOf.forEach((children, parent) => {
    for (const child of children) {
      const viaSibling = children.some((other) => other !== child && descendantsOf(other).has(child));
      if (viaSibling) redundant.add(`${parent}->${child}`);
    }
  });
  return redundant;
}
