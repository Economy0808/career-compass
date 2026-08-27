/**
 * 요소 유형 → 색 매핑 (단일 진실 공급원)
 *
 * 모든 컴포넌트(ConstellationCanvas, ElementBinPanel, ElementNotesPanel)는
 * 이 매핑을 통해 동일한 색으로 렌더링된다.
 *
 * CSS 변수 실값(hex):
 * - app/globals.css에 :root에 정의됨
 * - tailwind.config.ts에도 이중 정의됨 (config 파서 호환성 문제로 인해 두 곳 모두 필요)
 * - 수정 시 둘 다 갱신할 것.
 */

export type ElementType =
  | "course"
  | "certification"
  | "organization"
  | "activity"
  | "networking";

// 항성 분광형 악센트(globals.css --spec-*와 1:1로 대응)
// 새 type이 런타임에 생겨도 하드 실패하지 않도록 DEFAULT_TYPE_COLOR로 안전하게 떨어진다.
export const TYPE_COLOR: Record<string, string> = {
  course: "var(--spec-b)", // 수업
  certification: "var(--spec-a)", // 자격증
  organization: "var(--spec-g)", // 학회
  activity: "var(--spec-k)", // 대외활동
  networking: "var(--spec-m)", // 네트워킹
};

export const DEFAULT_TYPE_COLOR = "var(--text-lo)"; // 모르는 type도 이 색으로 안전하게 렌더링

export function colorForType(type: string): string {
  return TYPE_COLOR[type] ?? DEFAULT_TYPE_COLOR;
}
