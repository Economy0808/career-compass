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

// ── 실제 hex가 필요한 곳(별상 그라디언트·팔레트 비교)용 ──────────────────────
// 별상(星像) 렌더는 SVG 그라디언트 stop에 실색을 구워야 한다 - currentColor가
// 그라디언트 정의 위치 기준으로 풀리는 SVG 함정 때문에 CSS 변수 참조를 못 쓴다.
// 값은 globals.css --spec-*/--text-lo와 1:1 - 토큰을 바꾸면 여기도 같이 볼 것.
export const TYPE_DEFAULT_HEX: Record<string, string> = {
  course: "#9DB4FF",
  certification: "#E8ECFF",
  organization: "#FFD98A",
  activity: "#FFA76B",
  networking: "#FF7B72",
};

export const DEFAULT_TYPE_HEX = "#8891AC"; // --text-lo 실값

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 노드의 실색 hex. 커스텀 색(#RRGGBB)이 있으면 그것, 아니면 유형 기본값.
 * CSS 변수 문자열 등 hex가 아닌 값이 들어와도 기본값으로 안전 강등된다. */
export function hexForNode(type: string, color?: string): string {
  if (color && HEX_PATTERN.test(color)) return color;
  return TYPE_DEFAULT_HEX[type] ?? DEFAULT_TYPE_HEX;
}

/** hex를 흰색 쪽으로 t(0~1)만큼 섞는다 - 별상 시안 Rev.B의 mix() 그대로.
 * 임의 사용자 색에서 고온부·바늘 틴트를 파생하는 유일한 통로다. */
export function mixHex(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): string =>
    Math.round(c + (255 - c) * t)
      .toString(16)
      .padStart(2, "0");
  return "#" + f((n >> 16) & 255) + f((n >> 8) & 255) + f(n & 255);
}
