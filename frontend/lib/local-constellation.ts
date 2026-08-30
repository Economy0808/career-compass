"use client";

/**
 * 미인증 사용자(로그인은 했지만 yonseiVerified===false)의 캔버스 로컬 전용
 * 영속화 - 사용자 지시(2026-08-30): "저장은 못하게 하고... 어차피 API 랑
 * 대화를 못하니까 그거 브라우저 상에서만 저장해놨다가 인증하면 저장할지
 * 묻고 저장한다고 하면 저장하고 아니라 하면 폐기해."
 *
 * 서버 타입(CanvasNode 등)을 import하지 않는다 - localStorage에서 나오는
 * 값은 어차피 런타임에 검증되지 않은 데이터라, 호출부(page.tsx)가 자기
 * 타입으로 캐스팅해 쓰는 편이 이 파일을 다른 컴포넌트 타입 변경에 얽매이지
 * 않게 한다(순수 저장소 역할만).
 *
 * storage 인자는 기본값이 window.localStorage - Node 자체 점검(DOM 없이)
 * 때는 인메모리 mock을 넘겨 테스트한다.
 */

const VERSION = 1;
const KEY_PREFIX = "ourlab-local-constellation:";

export interface LocalConstellationDraft {
  version: number;
  nodes: Record<string, unknown>;
  edges: Record<string, unknown>;
  groups: Record<string, unknown>;
  notes: Record<string, unknown>;
  bins: unknown[];
}

export type DraftInput = Omit<LocalConstellationDraft, "version">;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function keyFor(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

function defaultStorage(): WritableStorage {
  return window.localStorage;
}

/** 노드도 보관함 항목도 하나 없으면 저장할 가치가 없다 - 데모 시드 그대로인
 * 상태를 새로고침마다 계속 쓰는 낭비를 막는다(+ 이미 저장돼 있던 빈 draft는
 * 지운다). */
function isEmptyDraft(draft: DraftInput): boolean {
  const hasNodes = Object.keys(draft.nodes).length > 0;
  const hasBinItems = draft.bins.some(
    (b) => Array.isArray((b as { items?: unknown[] })?.items) && (b as { items: unknown[] }).items.length > 0
  );
  return !hasNodes && !hasBinItems;
}

export function saveLocalDraft(uid: string, draft: DraftInput, storage: WritableStorage = defaultStorage()): void {
  try {
    if (isEmptyDraft(draft)) {
      storage.removeItem(keyFor(uid));
      return;
    }
    storage.setItem(keyFor(uid), JSON.stringify({ version: VERSION, ...draft }));
  } catch {
    // QuotaExceededError/프라이빗 모드 등 - 조용히 무시, 앱은 죽지 않는다.
  }
}

/** 버전 불일치·손상된 JSON·필수 필드 누락은 전부 조용히 null 취급(폐기)한다. */
export function loadLocalDraft(uid: string, storage: ReadableStorage = defaultStorage()): LocalConstellationDraft | null {
  try {
    const raw = storage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalConstellationDraft>;
    if (
      parsed.version !== VERSION ||
      typeof parsed.nodes !== "object" ||
      parsed.nodes === null ||
      typeof parsed.edges !== "object" ||
      parsed.edges === null ||
      !Array.isArray(parsed.bins)
    ) {
      return null;
    }
    return {
      version: VERSION,
      nodes: parsed.nodes,
      edges: parsed.edges,
      groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      bins: parsed.bins,
    };
  } catch {
    return null;
  }
}

export function clearLocalDraft(uid: string, storage: Pick<Storage, "removeItem"> = defaultStorage()): void {
  try {
    storage.removeItem(keyFor(uid));
  } catch {
    // 무시.
  }
}

export function hasLocalDraft(uid: string, storage: ReadableStorage = defaultStorage()): boolean {
  try {
    return storage.getItem(keyFor(uid)) !== null;
  } catch {
    return false;
  }
}
