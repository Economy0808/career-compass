/**
 * ConstellationDto → ConstellationCanvas props 매핑 공용 함수.
 *
 * 열람 전용 화면들(발행 별자리 뷰어 /constellation/{cid}, 게시물 상세의 작성자
 * 별자리 미리보기)이 같은 투영을 쓴다. 편집 화면(app/constellation/new)은 서버
 * 상태를 로컬 뮤테이션 큐로 관리하는 별도 경로라 이 파일을 쓰지 않는다.
 *
 * noteCount는 일부러 매핑하지 않는다 - 열람 화면은 노트를 다루지 않으므로
 * (공개/비공개 노트 정책이 백엔드에서 확정 전) "노트" UI가 뜰 여지를 없앤다.
 */

import type { CanvasEdge, CanvasGroup, CanvasNode } from "@/components/ConstellationCanvas";
import type { ConstellationDto } from "@/lib/constellation-api";

export function mapNodes(dto: ConstellationDto): Record<string, CanvasNode> {
  const nodes: Record<string, CanvasNode> = {};
  for (const n of Object.values(dto.nodes)) {
    nodes[n.id] = {
      id: n.id,
      label: n.label,
      type: n.type,
      isCompleted: n.isCompleted,
      position: n.position,
      level: n.level,
      code: n.code,
      description: n.description,
      color: n.color,
      glowEffect: n.glowEffect,
    };
  }
  return nodes;
}

export function mapEdges(dto: ConstellationDto): Record<string, CanvasEdge> {
  const edges: Record<string, CanvasEdge> = {};
  for (const e of Object.values(dto.edges)) {
    edges[e.id] = { id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, color: e.color };
  }
  return edges;
}

export function mapGroups(dto: ConstellationDto): Record<string, CanvasGroup> {
  const groups: Record<string, CanvasGroup> = {};
  for (const g of Object.values(dto.groups ?? {})) {
    groups[g.id] = { id: g.id, label: g.label, memberNodeIds: g.memberNodeIds, collapsed: g.collapsed, position: g.position };
  }
  return groups;
}
