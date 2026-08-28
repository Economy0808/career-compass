"use client";

/**
 * 원소 노트 패널 - 오른쪽 패널이 「군집」에서 「노트」로 바뀐 상태.
 *
 * 새 영역을 여는 게 아니라 ElementBinPanel과 같은 자리(같은 fixed 오버레이
 * 위치/치수)를 그대로 대체한다.
 *
 * 이제 "선택된 원소 하나"가 아니라 캔버스 위 모든 원소를 계단식(staircase)
 * 아코디언으로 나열한다 - 1단은 원소 바(닫혀 있으면 카운트만, 열리면 그
 * 원소의 노트들), 2단은 개별 노트(닫혀 있으면 제목/날짜, 열리면 편집기).
 * "계단"이라는 은유가 곧 "한 번에 한 경로"라는 뜻이므로 원소도 노트도 항상
 * 하나만 열려 있다 - 두 단 모두 다중 열림을 허용하면 실제 데이터량에서 패널이
 * 읽기 힘들어진다.
 *
 * 노트 자체는 이 컴포넌트가 소유하지 않는다 - 상태는 부모(page.tsx)의
 * React state에 그래프와 나란히 산다(백엔드 연동 전 데모라 새로고침하면
 * 사라진다). 이 컴포넌트는 순수 표현 계층 + 편집 폼 로컬 상태만 가진다.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import type { CanvasNode } from "@/components/ConstellationCanvas";
import { Markdown, type ResolveWikiLink } from "@/lib/markdown";

/**
 * 노트에 첨부된 이미지 - 지금은 백엔드가 없어 브라우저 메모리(object URL)만
 * 가리키지만, 나중에 실제 업로드가 생기면 url을 스토리지 URL로 바꿔치기만
 * 하면 되도록 형태를 미리 그 모습으로 잡아 둔다(원본 파일 blob을 노트 상태에
 * 직접 박아두지 않음). PDF/DOCX는 과금 정책이 정해지지 않아 의도적으로
 * 범위 밖 - mimeType이 자유 문자열이라 나중에 추가해도 이 타입 자체는 안 바뀐다.
 */
export interface NoteAttachment {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface ElementNote {
  id: string;
  nodeId: string;
  title: string;
  body: string;
  /** 기본값은 항상 false(비공개) - 실수로 공개되는 것이 실수로 비공개인 것보다
   * 훨씬 나쁘므로, 새 노트는 명시적으로 체크하지 않는 한 비공개로 시작한다. */
  isPublic: boolean;
  attachments: NoteAttachment[];
  createdAt: number;
  updatedAt: number;
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 확대 오버레이 포커스 트랩이 순회할 포커스 가능 요소 선택자 - 라이브러리 없이
 * 경량으로 충분한 수준. */
const FOCUSABLE_SELECTOR =
  'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * 타이포 스케일 두 개를 상수로 못박아 둔다(fluid clamp() 금지) - COLLAPSED는
 * 패널 안(~288px 너비)에서, EXPANDED는 720px 중앙 칼럼에서 각각 "이 정도가
 * 의도된 크기다"라고 디자이너가 나중에 손댈 수 있게 하는 고정 핀이다. 제목
 * input, 본문 textarea, 렌더링된 마크다운(제목 태그는 em 단위라 이 base
 * font-size에 비례해서 커진다) 세 군데 모두 이 값을 그대로 쓴다.
 */
const COLLAPSED_TYPE_SCALE = {
  titleFontSize: "18px",
  titleFontWeight: 700,
  titleLineHeight: 1.3,
  bodyFontSize: "13px",
  bodyLineHeight: 1.7,
} as const;
const EXPANDED_TYPE_SCALE = {
  titleFontSize: "30px",
  titleFontWeight: 700,
  titleLineHeight: 1.25,
  bodyFontSize: "16px",
  bodyLineHeight: 1.85,
} as const;

/** 옵시디언 스타일 명시적 모드 - "edit"는 원문(textarea), "read"는 렌더링된
 * 마크다운. 이전엔 포커스 유무로 암묵적으로 정해졌지만, 이제 토글 버튼이
 * 있는 sticky 상태라 blur돼도 "edit"에 그대로 머문다(자동저장만 실행). */
type NoteMode = "edit" | "read";

/** 확대된 편집기 위에서 열려 있는 탭 하나 - 항상 실재하는 노트를 가리킨다
 * (초안 상태의 "+ 새 노트"는 탭 시스템 범위 밖 - 아래 NewNoteEditor 참고). */
interface NoteTabInfo {
  key: string;
  nodeId: string;
}

function makeAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ElementNotesPanelProps {
  /** 캔버스 위 모든 노드 - 노트가 0개인 원소도 포함해서 항상 전부 나열한다. */
  nodes: CanvasNode[];
  /** nodeId -> 그 원소의 노트들. 카드의 "노트 N개"와 같은 진실(notesByNode)을
   * 그대로 받아써서 두 표시가 어긋나지 않게 한다. */
  notesByNode: Map<string, ElementNote[]>;
  /** "이 원소를 펼치고 스크롤해서 보여줘" 요청 - 카드의 「노트 N개 ›」나 노트
   * 본문의 [[위키링크]] 클릭에서 온다. token은 같은 nodeId를 다시 요청해도
   * (예: 같은 원소를 두 번 연달아 클릭) 효과가 재실행되도록 매번 증가한다. */
  expandNodeId: string | null;
  expandToken: number;
  /** 자동저장 첫 커밋에서 만들어진 노트 id를 돌려준다 - 새 노트 편집기가 이후의
   * 자동저장을 onCreateNote가 아니라 onUpdateNote(id, ...)로 이어가기 위해서다. */
  onCreateNote: (
    nodeId: string,
    input: { title: string; body: string; isPublic: boolean; attachments: NoteAttachment[] }
  ) => string;
  onUpdateNote: (
    id: string,
    patch: { title: string; body: string; isPublic: boolean; attachments: NoteAttachment[] }
  ) => void;
  onDeleteNote: (id: string) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
  /** 열린 노트 편집기가 "크게 보기" 상태인지 - 실제 폭 애니메이션은 이 패널을
   * 담는 aside(page.tsx)가 하므로, 이 컴포넌트는 상태만 부모와 공유한다. */
  isNoteExpanded: boolean;
  onNoteExpandedChange: (expanded: boolean) => void;
  className?: string;
}

// 유형→색 매핑은 lib/element-colors.ts에서 단일 진실 공급원으로 관리된다 -
// 캔버스 노드/보관함 칩/이 패널의 원소 바가 항상 같은 색을 쓴다.

function formatUpdatedAt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewOf(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

export function ElementNotesPanel({
  nodes,
  notesByNode,
  expandNodeId,
  expandToken,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  resolveLink,
  onLinkClick,
  isNoteExpanded,
  onNoteExpandedChange,
  className,
}: ElementNotesPanelProps) {
  // 1단(원소)과 2단(노트) 각각 "열려 있는 것 하나"만 기억한다. 2단 키는 실제
  // 노트 id이거나, 그 원소의 "+ 새 노트" 편집기를 가리키는 `new:{nodeId}`
  // 센티널이다 - 새 노트 작성도 "노트 하나가 열려 있다"는 규칙 안에 있어야
  // 하므로(그렇지 않으면 원소 하나를 펼치고 노트도 하나 편집 중인데 동시에
  // 새 노트 폼까지 열려버리는 상태가 가능해진다).
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const barRefs = useRef(new Map<string, HTMLButtonElement>());

  // --- 확대 시 탭 바 ---------------------------------------------------------
  // "확대된 상태에서 연 노트들"을 원소 경계와 무관하게 여기(패널 로컬 state)에
  // 쌓아 둔다. page.tsx가 오른쪽 패널을 「군집」 <-> 「노트」로 스왑할 때도 이
  // 컴포넌트 자체는 언마운트되지 않도록 부모를 고쳤으므로(항상 마운트, CSS로만
  // 숨김) 탭을 여기 두어도 패널을 오갈 때 사라지지 않는다.
  const [noteTabs, setNoteTabs] = useState<NoteTabInfo[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // "+" 피커에서 방금 "새 노트"로 만든 노트의 id - 그 노트의 편집기가 마운트되는
  // 순간 제목 input에 포커스를 넣기 위한 1회용 신호. 편집기가 그 포커스를
  // 실제로 넣고 나면 onTitleAutoFocusConsumed로 다시 null로 되돌려, 같은 노트를
  // 나중에 다시 열어도 제목에 강제로 포커스가 가지 않게 한다.
  const [autoFocusTitleKey, setAutoFocusTitleKey] = useState<string | null>(null);

  const notesById = useMemo(() => {
    const map = new Map<string, ElementNote>();
    for (const list of Array.from(notesByNode.values())) for (const n of list) map.set(n.id, n);
    return map;
  }, [notesByNode]);

  const nodeIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  // "+" 피커에 쓸 전체 원소 목록 - 노트가 0개인 원소도 포함해야 그 원소 아래에
  // "새 노트" 행을 보여줄 수 있다(예전엔 노트가 하나도 없는 원소 자체가
  // 목록에서 빠져 있어 그 원소에 새 노트를 만들 방법이 없었다).
  const pickerSections = useMemo(
    () =>
      nodes.map((n) => ({
        nodeId: n.id,
        label: n.label,
        code: n.code,
        notes: [...(notesByNode.get(n.id) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
      })),
    [nodes, notesByNode]
  );

  // 탭 추가/활성화 - 패널의 어느 원소가 열려 있든 그 노트로 아코디언 초점을
  // 옮기고(expandedNodeId/activeNoteKey는 "지금 확대되어 보이는 노트"를 가리키는
  // 기존 상태를 그대로 재사용) 확대 스위치를 켠다.
  // expandIntentRef를 여기서 함께 세팅한다 - activeNoteKey를 바꾸는 모든 탭
  // 조작(열기/전환/이웃 활성화)이 아래쪽 "확장 상태 리셋" effect(활성 노트가
  // 바뀌면 기본적으로 축소로 되돌리는 effect)에 걸려 방금 켠 확대를 도로
  // 꺼버리지 않도록 하기 위해서다.
  // isNoteExpanded는 항상 이 함수를 거쳐서만 바꾼다 - false로 끌 때
  // internalCollapseRef를 세워 둬서, 아래쪽 정리 effect가 "이 컴포넌트 스스로
  // 끈 것"(closeOverlay/closeTab/Esc - 아코디언 위치를 보존한 채 인라인으로
  // 돌아가는 기존 설계)과 "부모가 패널 세그먼트 전환으로 강제로 끈 것"(완전히
  // 정리해야 함)을 구분한다. true로 켤 때는 지난 플래그를 리셋한다.
  function setExpanded(expanded: boolean) {
    internalCollapseRef.current = !expanded;
    onNoteExpandedChange(expanded);
  }

  function activateNoteExpanded(nodeId: string, noteId: string) {
    expandIntentRef.current = noteId;
    setExpandedNodeId(nodeId);
    setActiveNoteKey(noteId);
    setExpanded(true);
  }

  // 확대 상태에서 노트 본문 위키링크를 클릭했을 때 - 부모 경로(캔버스 포커스 +
  // 패널 전환, 옛 단일확장 경로) 대신 탭으로 연다. 대상 원소에 노트가 없으면
  // 열 탭이 없으므로 부모 경로로 폴백한다(새 노트를 자동으로 만들지 않는다).
  // 접힌 상태에서는 이 래핑을 타지 않고 부모 경로를 그대로 쓴다.
  function handleWikiLinkClick(nodeId: string) {
    if (isNoteExpanded) {
      const targetNotes = notesByNode.get(nodeId) ?? [];
      if (targetNotes.length > 0) {
        const latest = targetNotes.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        openTab(nodeId, latest.id);
        return;
      }
    }
    onLinkClick(nodeId);
  }

  // 탭 바의 원래 취지: "그 원소의 노트들 사이를 편하게 오가기". 그런데 지금까지는
  // 노트를 하나씩 열 때마다(행 확대 버튼이든 + 피커든) 그 노트 하나만 탭으로
  // 쌓여서, 형제 노트가 여러 개 있어도 탭 바에는 방금 연 것 하나만 보이는
  // 버그였다. 이제 "어떤 경로로든 한 원소의 노트를 확대해서 연다"는 항상 그
  // 원소의 노트 전부를(이미 열려 있는 것은 건드리지 않고 없는 것만 추가) 탭으로
  // 갖춰 두도록 openTab/createNoteInTab이 공통으로 이 함수를 거친다. 다른
  // 원소의 기존 탭은 건드리지 않는다(원래 설계: 원소 경계 무관하게 탭이 쌓인다).
  function ensureElementTabs(nodeId: string, activeNoteId: string) {
    setNoteTabs((prev) => {
      const siblingIds = [...(notesByNode.get(nodeId) ?? [])]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((n) => n.id);
      // activeNoteId가 방금 막 생성된 노트라면(같은 렌더 사이클 안이라
      // notesByNode에 아직 반영되지 않았을 수 있다) 형제 목록에 없을 때만
      // 끝에 더해 준다.
      const orderedIds = siblingIds.includes(activeNoteId) ? siblingIds : [...siblingIds, activeNoteId];
      const existingKeys = new Set(prev.map((t) => t.key));
      const toAdd = orderedIds.filter((id) => !existingKeys.has(id)).map((id) => ({ key: id, nodeId }));
      return toAdd.length === 0 ? prev : [...prev, ...toAdd];
    });
  }

  function openTab(nodeId: string, noteId: string) {
    ensureElementTabs(nodeId, noteId);
    setActiveTabKey(noteId);
    activateNoteExpanded(nodeId, noteId);
    setPickerOpen(false);
  }

  // "+" 피커의 "새 노트" 행 - 그 자리에서 바로 노트를 만들고(onCreateNote는
  // page.tsx의 생성 경로를 그대로 타므로 제목 기본값 "무제"/isPublic:false 등
  // 규칙이 여기서도 동일하게 적용된다), 그 원소의 기존 노트들 + 새 노트를 탭으로
  // 갖추고 새 노트를 활성화한다. 노트가 아직 비어 있으니 제목부터 적을 수 있게
  // title autofocus 신호도 함께 켠다.
  function createNoteInTab(nodeId: string) {
    const newId = onCreateNote(nodeId, { title: "", body: "", isPublic: false, attachments: [] });
    ensureElementTabs(nodeId, newId);
    setActiveTabKey(newId);
    activateNoteExpanded(nodeId, newId);
    setAutoFocusTitleKey(newId);
    setPickerOpen(false);
  }

  function switchTab(key: string) {
    const tab = noteTabs.find((t) => t.key === key);
    if (!tab) return;
    setActiveTabKey(key);
    activateNoteExpanded(tab.nodeId, key);
  }

  // 탭 하나를 닫는다. 그게 활성 탭이었으면 이웃 탭을 활성화하고, 마지막 탭이면
  // 확대 자체를 끈다(요청: "닫히면 확대 뷰가 접힌다").
  // 이웃 활성화(setActiveTabKey/activateNoteExpanded)는 setNoteTabs 업데이터
  // "안"이 아니라 바깥의 형제 문장으로 둔다 - 업데이터 함수는 순수해야 하는데
  // 그 안에서 다른 컴포넌트의 setState(onNoteExpandedChange가 부모 state를
  // 바꾼다)까지 부르면 렌더 중 부모 업데이트("Cannot update a component while
  // rendering")가 되어 StrictMode에서 경고 + 이중 호출이 난다. noteTabs/
  // activeTabKey는 클릭 핸들러 시점의 최신 커밋된 값이므로 굳이 함수형
  // 업데이터가 아니어도 안전하다.
  function closeTab(key: string) {
    const idx = noteTabs.findIndex((t) => t.key === key);
    if (idx === -1) return;
    const next = [...noteTabs.slice(0, idx), ...noteTabs.slice(idx + 1)];
    setNoteTabs(next);
    if (activeTabKey === key) {
      const neighbor = next[idx] ?? next[idx - 1];
      if (neighbor) {
        setActiveTabKey(neighbor.key);
        activateNoteExpanded(neighbor.nodeId, neighbor.key);
      } else {
        setActiveTabKey(null);
        setExpanded(false);
      }
    }
  }

  // 고스트 탭 정리: 노트가 (노트 삭제 또는 그 노트가 속한 원소/노드 삭제로)
  // 더 이상 존재하지 않으면 그 탭도 사라져야 한다 - 안 그러면 탭 칩만 남고
  // 활성화해도 포탈이 렌더되지 않는 죽은 자리가 된다. 렌더 중이 아니라 커밋 후
  // effect에서 실행하므로 closeTab과 마찬가지로 이웃 활성화를 형제 문장으로 둘 수
  // 있다(setState-in-render 문제 없음).
  useEffect(() => {
    const stale = noteTabs.filter((t) => !notesById.has(t.key) || !nodeIdSet.has(t.nodeId));
    if (stale.length === 0) return;
    const idx = activeTabKey ? noteTabs.findIndex((t) => t.key === activeTabKey) : -1;
    const next = noteTabs.filter((t) => notesById.has(t.key) && nodeIdSet.has(t.nodeId));
    setNoteTabs(next);
    if (activeTabKey && stale.some((t) => t.key === activeTabKey)) {
      const neighbor = next[idx] ?? next[idx - 1];
      if (neighbor) {
        setActiveTabKey(neighbor.key);
        activateNoteExpanded(neighbor.nodeId, neighbor.key);
      } else {
        setActiveTabKey(null);
        setExpanded(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteTabs, notesById, nodeIdSet, activeTabKey]);

  // 탭 바 오른쪽 끝의 닫기(축소) 버튼 - "확대"를 끄기만 한다. expandedNodeId/
  // activeNoteKey는 그대로 두므로 활성 탭이었던 노트의 패널 내 인라인 편집기로
  // 자연스레 돌아간다(그 노트의 아코디언 행이 이미 열려 있는 상태이므로).
  function closeOverlay() {
    setExpanded(false);
  }
  // "확대 버튼으로 노트를 연 것"이라는 의도를 activeNoteKey가 바뀐 뒤(커밋 후)
  // 실행되는 아래 리셋 effect에 전달하기 위한 값 - 없으면 그 effect가 매번
  // false로 덮어써서 확대 버튼이 두 번 클릭해야 먹는 버그가 생긴다.
  const expandIntentRef = useRef<string | null>(null);
  // setExpanded(false)가 "이 컴포넌트 스스로 끈 것"인지 표시하는 플래그 - 아래
  // "부모가 강제로 끈 경우만 정리" effect가 읽는다.
  const internalCollapseRef = useRef(false);

  // 외부 요청(카드의 「노트 N개 ›」, 노트 속 [[위키링크]] 클릭) - 그 원소만
  // 펼치고 다른 건 다 접은 뒤, 시야 밖에 있으면 스크롤해서 보여준다. 노트
  // 단(2단)은 일부러 접어 둔 채로 둔다 - "그 원소의 노트로 왔다"는 것과 "특정
  // 노트의 편집 폼에 포커스를 강제로 넣는다"는 다른 얘기이고, 후자는 캔버스의
  // Delete/Backspace 삭제 단축키와 맞물려 예상 밖의 포커스 위치가 위험하다.
  useEffect(() => {
    if (!expandNodeId) return;
    setExpandedNodeId(expandNodeId);
    setActiveNoteKey(null);
    const raf = requestAnimationFrame(() => {
      barRefs.current.get(expandNodeId)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
    // expandToken만 바뀌어도(같은 원소를 다시 가리켜도) 재실행되어야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandToken]);

  // 열려 있는 노트가 바뀌거나 닫히면 "크게 보기"도 함께 원상복구한다 - 다른
  // 노트로 옮겨갔는데 이전 노트의 확장 상태가 그대로 남아있으면 안 되므로.
  // 단, 이번 전환이 확대 버튼의 "닫힌 노트를 열면서 바로 확대" 의도였다면
  // (expandIntentRef가 방금 활성화된 노트를 가리키면) false로 덮어쓰지 않고
  // true를 유지한다 - 그렇지 않으면 setActiveNoteKey로 인한 이 effect 재실행이
  // 버튼 핸들러가 방금 켠 true를 즉시 꺼버려서 한 번 클릭으로는 확대되지
  // 않는 버그가 생긴다(두 번째 클릭에서야 반영됨).
  useEffect(() => {
    if (expandIntentRef.current !== null && expandIntentRef.current === activeNoteKey) {
      expandIntentRef.current = null;
      setExpanded(true);
      return;
    }
    expandIntentRef.current = null;
    setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteKey]);

  // 부모(page.tsx)가 패널 세그먼트를 「군집」 등으로 전환하면서 isNoteExpanded를
  // 직접 false로 떨어뜨리는 경우에만(internalCollapseRef가 안 서 있을 때만)
  // 아코디언 확대 대상을 완전히 정리한다 - closeOverlay/closeTab/Esc처럼 이
  // 컴포넌트 스스로 끈 경우는 "인라인 편집기로 자연스레 돌아간다"는 기존
  // 설계를 그대로 둔다. noteTabs(탭 목록)는 두 경우 모두 절대 비우지 않는다.
  const prevIsNoteExpandedRef = useRef(isNoteExpanded);
  useEffect(() => {
    if (prevIsNoteExpandedRef.current && !isNoteExpanded) {
      if (internalCollapseRef.current) {
        internalCollapseRef.current = false;
      } else {
        setExpandedNodeId(null);
        setActiveNoteKey(null);
      }
    }
    prevIsNoteExpandedRef.current = isNoteExpanded;
  }, [isNoteExpanded]);

  // 캔버스에 원소가 하나도 없을 때만 빈 상태를 보여준다 - "원소를 선택 안 함"
  // 빈 상태는 이제 존재하지 않는다(탭은 항상 내용을 갖는다).
  if (nodes.length === 0) {
    return (
      <div
        id="panel-notes"
        role="tabpanel"
        aria-label="노트"
        tabIndex={0}
        className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
      >
        <p className="px-3 py-6 text-center font-sans text-body-sm leading-relaxed text-paper-lo">
          캔버스에 아직 원소가 없어요. 원소를 놓으면 여기서 노트를 볼 수 있어요.
        </p>
      </div>
    );
  }

  return (
    <div
      id="panel-notes"
      role="tabpanel"
      aria-label="노트"
      tabIndex={0}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      <div className="canvas-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {nodes.map((node) => {
          const notes = [...(notesByNode.get(node.id) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
          const isOpen = expandedNodeId === node.id;
          const regionId = `notes-region-${node.id}`;
          const barId = `notes-bar-${node.id}`;
          const newNoteKey = `new:${node.id}`;

          return (
            <div key={node.id} className="rounded-none border border-paper-line bg-paper">
              <button
                type="button"
                id={barId}
                ref={(el) => {
                  if (el) barRefs.current.set(node.id, el);
                  else barRefs.current.delete(node.id);
                }}
                aria-expanded={isOpen}
                aria-controls={regionId}
                onClick={() =>
                  setExpandedNodeId((cur) => {
                    const next = cur === node.id ? null : node.id;
                    setActiveNoteKey(null);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 rounded-none px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: colorForType(node.type) }}
                />
                <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-paper-ink">
                  {node.label}
                </span>
                {node.code && <span className="shrink-0 font-mono text-[11px] text-paper-lo">{node.code}</span>}
                <span className="shrink-0 font-sans text-[11px] text-paper-lo">{notes.length}개</span>
                <span
                  aria-hidden
                  className={cn("shrink-0 text-paper-lo transition-transform", isOpen && "rotate-90")}
                >
                  {"›"}
                </span>
              </button>

              {isOpen && (
                <div id={regionId} role="region" aria-labelledby={barId} className="space-y-1.5 border-t border-paper-line px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setActiveNoteKey((cur) => (cur === newNoteKey ? null : newNoteKey))}
                    className="w-full rounded-none border border-dashed border-paper-line px-2.5 py-1.5 text-left font-sans text-xs text-paper-lo hover:border-paper-ink hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
                  >
                    {"+ 새 노트"}
                  </button>

                  {activeNoteKey === newNoteKey && (
                    <NewNoteEditor
                      nodeId={node.id}
                      onCreateNote={onCreateNote}
                      onUpdateNote={onUpdateNote}
                      onClose={() => setActiveNoteKey(null)}
                      resolveLink={resolveLink}
                      onLinkClick={handleWikiLinkClick}
                      isExpanded={isNoteExpanded}
                      onExpandedChange={setExpanded}
                    />
                  )}

                  {notes.length === 0 ? (
                    <p className="px-1 py-4 text-center font-sans text-[11px] leading-relaxed text-paper-lo">
                      아직 노트가 없어요. 여기서 배운 걸 처음으로 적어보세요.
                    </p>
                  ) : (
                    notes.map((note) => {
                      const noteOpen = activeNoteKey === note.id;
                      const noteRegionId = `note-region-${note.id}`;
                      const noteBarId = `note-bar-${note.id}`;
                      return (
                        <div key={note.id} className="rounded-none border border-paper-line bg-paper-soft">
                          {/* "직사각형 상단" - 노트패드가 아니라 이 행의 헤더. 확대
                              버튼과 부가 옵션(⋮ 메뉴)이 여기 산다. 제목은 굵고 잘리지
                              않게(요청 3) - 대신 두 번째 줄(본문 미리보기)만 truncate. */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                            <button
                              type="button"
                              id={noteBarId}
                              aria-expanded={noteOpen}
                              aria-controls={noteRegionId}
                              onClick={() => setActiveNoteKey(noteOpen ? null : note.id)}
                              className="min-w-0 flex-1 rounded-none text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
                            >
                              <div className="font-sans text-sm font-bold text-paper-ink">
                                {note.title || "무제"}
                              </div>
                              <div className="truncate font-sans text-[10px] text-paper-lo">
                                {previewOf(note.body) || "내용 없음"}
                              </div>
                            </button>
                            <button
                              type="button"
                              aria-pressed={isNoteExpanded && activeTabKey === note.id}
                              aria-label={isNoteExpanded && activeTabKey === note.id ? "노트 축소" : "노트 확대"}
                              onClick={() => {
                                if (isNoteExpanded && activeTabKey === note.id) {
                                  closeOverlay();
                                } else {
                                  openTab(node.id, note.id);
                                }
                              }}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-paper-line text-paper-lo hover:border-paper-ink hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
                            >
                              {/* 사이드 패널 글리프: 사각형 + 세로 분할선(이미지 1) -
                                  이전의 모서리 화살표(⛶) 스타일을 대체. */}
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                                <rect x="1" y="1.5" width="11" height="10" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M8.3 1.5v10" stroke="currentColor" strokeWidth="1.2" />
                              </svg>
                            </button>
                            <NoteKebabMenu
                              isPublic={note.isPublic}
                              createdAt={note.createdAt}
                              onTogglePublic={() => onUpdateNote(note.id, { ...note, isPublic: !note.isPublic })}
                              onDelete={() => onDeleteNote(note.id)}
                            />
                          </div>
                          {noteOpen && (
                            <div
                              id={noteRegionId}
                              role="region"
                              aria-labelledby={noteBarId}
                              className="border-t border-paper-line px-2.5 py-2"
                            >
                              <NoteEditor
                                initial={{
                                  title: note.title,
                                  body: note.body,
                                  attachments: note.attachments,
                                }}
                                isPublic={note.isPublic}
                                onClose={() => setActiveNoteKey(null)}
                                resolveLink={resolveLink}
                                onLinkClick={handleWikiLinkClick}
                                isExpanded={isNoteExpanded}
                                onExpandedChange={setExpanded}
                                onPersist={(input) => onUpdateNote(note.id, input)}
                                autoFocusTitle={autoFocusTitleKey === note.id}
                                onTitleAutoFocusConsumed={() => setAutoFocusTitleKey(null)}
                                tabBar={
                                  isNoteExpanded
                                    ? (toggle) => (
                                        <NoteTabBar
                                          elementLabel={node.label}
                                          elementCode={node.code}
                                          tabs={noteTabs}
                                          activeTabKey={activeTabKey}
                                          notesById={notesById}
                                          onSwitchTab={switchTab}
                                          onCloseTab={closeTab}
                                          onCloseOverlay={closeOverlay}
                                          pickerSections={pickerSections}
                                          pickerOpen={pickerOpen}
                                          onPickerOpenChange={setPickerOpen}
                                          onPickNote={openTab}
                                          onCreateNote={createNoteInTab}
                                          mode={toggle.mode}
                                          onToggleMode={toggle.onToggleMode}
                                        />
                                      )
                                    : undefined
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface NoteEditorProps {
  initial: { title: string; body: string; attachments: NoteAttachment[] };
  /** 공개/비공개는 이제 이 편집기가 소유하지 않는다 - 행 헤더의 ⋮ 메뉴가 부모
   * 상태(note.isPublic)를 직접 토글하므로, 편집기는 매 렌더 최신 값을 프롭으로
   * 받아 자동저장 페이로드에 그대로 실어 보내기만 한다(로컬 state로 복사해두면
   * 편집 중 ⋮ 메뉴가 바꾼 값을 다음 자동저장이 덮어써버리는 경쟁 상태가 생긴다). */
  isPublic: boolean;
  /** Esc/포커스 아웃 등으로 편집기를 닫아 달라는 요청 - "취소"가 아니다. 자동저장이
   * 이미 최신 초안을 커밋했으므로 닫아도 입력은 유실되지 않는다. */
  onClose: () => void;
  /** 자동저장 커밋 한 번 - 편집기를 닫지 않는다. 디바운스/blur/Esc/언마운트에서
   * 호출된다. */
  onPersist: (input: { title: string; body: string; isPublic: boolean; attachments: NoteAttachment[] }) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** "+ 새 노트"(아직 한 번도 저장된 적 없는) 경로인지 - true면 flushSave가
   * 완전히 빈 상태에서는 저장을 건너뛴다(빈 노트를 만들지 않기 위해). 기존
   * 노트(false, 기본값)는 이미 실재하므로, 사용자가 내용을 전부 지웠다면
   * 그 빈 상태도 그대로 저장해야 한다 - 지워도 옛 내용이 되살아나면 안 된다. */
  isNewNote?: boolean;
  /** 확대 상태에서만 렌더할 탭 바(요소 이름/노트 제목 브레드크럼, 탭 칩, +
   * 피커, 닫기 버튼을 포함) - 부모(ElementNotesPanel)가 탭 목록을 소유하므로
   * 완성된 노드를 그대로 받아 상단에 얹기만 한다. 접힌 상태나 "+ 새 노트"
   * 초안 경로에서는 undefined. 읽기/편집 모드 토글 버튼은 탭 바의 ⫿ 버튼
   * 바로 왼쪽에 들어가야 하는데, 그 버튼은 이 편집기의 로컬 state(mode)를
   * 알아야 하므로 완성된 엘리먼트가 아니라 렌더 함수로 받아 mode/onToggle을
   * 그 자리에서 주입한다. */
  tabBar?: (toggle: { mode: NoteMode; onToggleMode: () => void }) => ReactNode;
  /** "+" 피커의 "새 노트"로 방금 만들어진 노트가 처음 마운트될 때만 true -
   * 제목 input에 포커스를 넣어 바로 이름을 지을 수 있게 한다. */
  autoFocusTitle?: boolean;
  /** autoFocusTitle을 실제로 소비(포커스 실행)했다는 신호 - 부모가 1회용
   * 상태를 다시 null로 되돌려 같은 노트를 나중에 재방문해도 재발동하지 않게 한다. */
  onTitleAutoFocusConsumed?: () => void;
}

/**
 * 옵시디언 스타일 읽기/편집 모드 토글 - 아이콘은 "지금 상태"가 아니라 "눌렀을
 * 때 들어갈 모드"를 보여준다(옵시디언 관례): 편집 중이면 책(→읽기), 읽는
 * 중이면 연필(→편집). 접힌 편집기의 바닥 줄(⋯ 왼쪽)과 확대 탭 바(⫿ 왼쪽)
 * 두 자리에서 재사용한다.
 */
function NoteModeToggleButton({
  mode,
  onToggle,
  paper = false,
}: {
  mode: NoteMode;
  onToggle: () => void;
  /** 접힌 편집기(종이 표면 아코디언)에서 쓰일 때만 true - 확대 탭 바(잉크
   * 표면, NoteTabBar)에서는 기본값(잉크)을 그대로 쓴다. */
  paper?: boolean;
}) {
  const isEdit = mode === "edit";
  const label = isEdit ? "읽기 모드로 전환" : "편집 모드로 전환";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-none border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
        paper
          ? "border-paper-line text-paper-lo hover:border-paper-ink hover:text-paper-ink focus-visible:outline-paper-ink"
          : "border-rule text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline-spec-b"
      )}
    >
      {isEdit ? (
        // 펼쳐진 책 - 클릭하면 읽기 모드로 전환.
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path
            d="M1.5 2.7c1.4-.8 2.9-.8 4.3 0v7.6c-1.4-.8-2.9-.8-4.3 0z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <path
            d="M11.5 2.7c-1.4-.8-2.9-.8-4.3 0v7.6c1.4-.8 2.9-.8 4.3 0z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // 연필 - 클릭하면 편집 모드로 전환.
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path
            d="M8.6 2.1l2.3 2.3-6.6 6.6H2v-2.3z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

const AUTOSAVE_DEBOUNCE_MS = 800;

function NoteEditor({
  initial,
  isPublic,
  onClose,
  onPersist,
  resolveLink,
  onLinkClick,
  isExpanded,
  onExpandedChange,
  isNewNote = false,
  tabBar,
  autoFocusTitle = false,
  onTitleAutoFocusConsumed,
}: NoteEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 확대 오버레이 포커스 격리: isExpanded가 켜지면 이전 포커스를 기억해 두고
  // 컨테이너 안 첫 포커스 가능한 요소로 옮긴다(브랜드 뉴 노트라면 바로 아래
  // autoFocusTitle effect가 이 직후 실행되어 제목으로 다시 옮기므로 최종
  // 포커스는 그쪽이 이긴다 - effect 선언 순서가 곧 실행 순서). 꺼지면(또는
  // 언마운트되면) 이전 포커스를 복원한다.
  useEffect(() => {
    if (!isExpanded) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = overlayContainerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // "새 노트" 방금 생성 직후 마운트되는 이 인스턴스에서만 제목에 포커스를
  // 넣는다 - 마운트 1회만 실행되어야 하므로 deps를 비워 둔다(autoFocusTitle이
  // 나중에 다시 true가 될 일은 없다: 부모가 소비 즉시 null로 되돌린다).
  useEffect(() => {
    if (autoFocusTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      onTitleAutoFocusConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 옵시디언 스타일 명시적 모드 토글 - 더 이상 포커스로 암묵 전환하지 않는다.
  // 새로 만든 노트는 바로 타이핑할 수 있게 "edit"으로, 기존 노트를 열 때는
  // "read"로 시작한다. "새로 만든 노트"는 두 경로로 들어온다: (1) 아코디언의
  // "+ 새 노트"(NewNoteEditor, isNewNote=true - 아직 실재하지 않는 초안),
  // (2) 탭 피커의 "+ 새 노트"(createNoteInTab - onCreateNote로 즉시 실재하는
  // 노트를 만들고 바로 이 일반 NoteEditor 경로로 여는데, isNewNote는 안
  // 넘어오므로 대신 autoFocusTitle 신호로 "방금 막 만들어졌다"를 판별한다).
  // blur는 이제 모드를 바꾸지 않는다(자동저장만).
  const [mode, setMode] = useState<NoteMode>(isNewNote || autoFocusTitle ? "edit" : "read");
  // 렌더링된 본문 클릭 -> 편집 진입 시에만 textarea에 포커스를 넣기 위한 1회용
  // 신호. requestAnimationFrame 대신 커밋 후 실행되는 effect를 쓴다 - mode가
  // "edit"로 바뀌어 textarea가 막 렌더된 시점에도 ref가 이미 붙어 있으므로
  // rAF 없이도 안전하게 포커스를 넣을 수 있다.
  const focusOnEditRef = useRef(false);
  useEffect(() => {
    if (mode === "edit" && focusOnEditRef.current) {
      focusOnEditRef.current = false;
      textareaRef.current?.focus();
    }
  }, [mode]);
  const [attachments, setAttachments] = useState<NoteAttachment[]>(initial.attachments);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 이번 편집 세션에서 새로 만든 object URL만 추적한다 - 편집기가 닫히면(자동저장
  // 후 collapse/노트 전환) 이 URL들만 회수한다. initial로 받은, 이미 저장된
  // 첨부의 URL은 노트가 살아있는 한(다시 열릴 수 있으므로) 여기서 회수하면 안 된다.
  const pendingUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending = pendingUrlsRef.current;
    return () => {
      pending.forEach((url) => URL.revokeObjectURL(url));
      pending.clear();
    };
  }, []);

  // --- 자동저장 -----------------------------------------------------------
  // 항상 최신값을 가리키는 ref들 - setTimeout 콜백/언마운트 클린업이 클로저에
  // 갇힌 옛 값을 저장하지 않도록 한다.
  const draftRef = useRef({ title, body, attachments });
  useEffect(() => {
    draftRef.current = { title, body, attachments };
  }, [title, body, attachments]);
  const isPublicRef = useRef(isPublic);
  useEffect(() => {
    isPublicRef.current = isPublic;
  }, [isPublic]);
  const onPersistRef = useRef(onPersist);
  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 첨부는 내용이 바뀌지 않고 추가/삭제만 되므로 id 나열만으로 서명을 만든다.
  function attachmentsSignatureOf(atts: NoteAttachment[]): string {
    return atts.map((a) => a.id).join(",");
  }

  // 이 노트가 실제로 한 번이라도 저장된 적 있는지 - "+ 새 노트"는 false로
  // 시작하고(아직 실재하지 않으므로 완전히 빈 채로 저장하지 않는다), 기존
  // 노트를 여는 경우는 true로 시작한다(이미 실재하므로 사용자가 다 지운
  // 빈 상태도 그대로 저장해야 옛 내용이 되살아나지 않는다).
  const everPersistedRef = useRef(!isNewNote);
  // 마지막으로 실제 저장된 값의 스냅샷 - 노트를 열기만 하고 아무것도 안
  // 바꿨는데 800ms 디바운스나 닫을 때(언마운트) flushSave가 똑같은 내용을
  // 다시 써서 updatedAt만 갱신하고 목록 순서를 흔드는 것을 막는다.
  const lastCommittedRef = useRef({
    title: initial.title,
    body: initial.body,
    attachmentsSignature: attachmentsSignatureOf(initial.attachments),
  });

  function flushSave() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    const d = draftRef.current;
    const rawTitle = d.title.trim();
    const rawBody = d.body.trim();
    // 브랜드 뉴 노트(아직 한 번도 저장된 적 없음) 경로에서만 "전부 비어 있으면
    // 저장 안 함" 가드를 적용한다 - 새 노트를 열기만 하고 아무것도 안 적은 채
    // 접는 경우 빈 노트를 만들지 않기 위해서다. 이미 실재하는 노트는 사용자가
    // 의도적으로 내용을 전부 지웠을 수 있으므로 이 가드에서 제외한다.
    if (!everPersistedRef.current && !rawTitle && !rawBody && d.attachments.length === 0) return;
    const committedTitle = rawTitle || "무제";
    const committedBody = d.body;
    const attachmentsSignature = attachmentsSignatureOf(d.attachments);
    const last = lastCommittedRef.current;
    // 마지막 커밋과 완전히 같으면 아무 것도 바뀐 게 없다는 뜻 - 그냥 열었다
    // 닫기만 한 경우가 대표적이다. 여기서 멈추면 updatedAt이 갱신되지 않아
    // 목록 순서가 흔들리지 않는다.
    if (last.title === committedTitle && last.body === committedBody && last.attachmentsSignature === attachmentsSignature) {
      return;
    }
    onPersistRef.current({
      title: committedTitle,
      body: committedBody,
      isPublic: isPublicRef.current,
      attachments: d.attachments,
    });
    everPersistedRef.current = true;
    lastCommittedRef.current = { title: committedTitle, body: committedBody, attachmentsSignature };
    // 커밋되면 이 첨부들의 object URL 소유권은 상위 상태(notes)로 넘어간다 -
    // 이 편집기가 나중에 언마운트돼도 더 이상 회수 대상이 아니다(회수하면
    // 방금 저장된 노트의 이미지가 깨진다).
    pendingUrlsRef.current.clear();
  }

  // 타이핑 중 ~800ms 디바운스 자동저장.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  // 첨부 변경(붙여넣기/⋯로 추가, × 삭제)은 타이핑처럼 연속적이지 않으니 디바운스
  // 없이 즉시 커밋한다. 마운트 시 initial 그대로는 다시 저장하지 않는다.
  const skipFirstAttachSave = useRef(true);
  useEffect(() => {
    if (skipFirstAttachSave.current) {
      skipFirstAttachSave.current = false;
      return;
    }
    flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  // 노트 전환/collapse는 이 컴포넌트의 언마운트로 나타난다(부모가 noteOpen이길
  // 조건부 렌더하므로) - 언마운트 시 마지막 초안을 반드시 커밋한다.
  useEffect(() => {
    return () => flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function attachFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachError(null);
    const accepted: NoteAttachment[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setAttachError(`이미지 파일만 첨부할 수 있어요: ${file.name}`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachError(`파일 용량이 너무 커요(최대 10MB): ${file.name}`);
        continue;
      }
      const url = URL.createObjectURL(file);
      pendingUrlsRef.current.add(url);
      accepted.push({ id: makeAttachmentId(), name: file.name, mimeType: file.type, url });
    }
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 클립보드에 이미지가 있으면(스크린샷 붙여넣기 등) 텍스트로 붙여넣는 대신
  // 첨부로 받는다 - 붙여넣기가 주 경로, ⋯ 메뉴의 파일 선택은 보조 경로.
  function handleBodyPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      attachFiles(files);
    }
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target && pendingUrlsRef.current.has(target.url)) {
        URL.revokeObjectURL(target.url);
        pendingUrlsRef.current.delete(target.url);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  function handleEscape() {
    // 확장 상태면 Esc는 편집기를 닫는 대신 스위치만 끈다("크게 보기"에서
    // 빠져나가는 걸 우선한다 - 스위치를 직접 끄는 것과 동일 동작).
    if (isExpanded) {
      onExpandedChange(false);
      return;
    }
    // 자동저장이므로 Esc는 "취소"가 아니라 "닫기" - 닫히기 전에 최신 초안부터
    // 커밋한다(닫히면 언마운트 클린업도 flushSave를 부르지만, 순서를 명시적으로
    // 보장하기 위해 여기서도 부른다).
    flushSave();
    onClose();
  }

  // 렌더링된 본문을 클릭하면 편집 모드로 들어간다 - 단, 클릭한 게 위키링크나
  // 일반 링크(버튼/앵커)라면 그건 "이동"이 목적이지 "편집 진입"이 아니므로
  // 무시한다.
  function enterEditMode(e?: { target: EventTarget }) {
    if (e && e.target instanceof HTMLElement && e.target.closest("button, a")) return;
    focusOnEditRef.current = true;
    setMode("edit");
  }

  // 편집기 컨테이너 스코프 keydown - 두 가지 역할:
  // (1) Escape: 읽기 모드 본문 래퍼가 예전엔 role="button"+tabIndex로 직접
  //     Escape를 받았지만(ARIA 중첩 문제로 제거), 제목 input/textarea는 이미
  //     각자 자기 onKeyDown에서 handleEscape를 부르므로 여기서는 그 두
  //     요소가 아닐 때만(예: 첨부 삭제 버튼 등에 포커스가 있을 때) 처리해
  //     중복 호출을 피한다.
  // (2) Tab/Shift+Tab: isExpanded일 때만 컨테이너 안의 포커스 가능한 요소
  //     사이에서 순환시켜(포커스 트랩) 뒤 패널로 Tab이 새지 않게 한다.
  //     전역 window 리스너가 아니라 이 컨테이너 스코프에서만 가로챈다.
  function handleOverlayKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        handleEscape();
      }
      return;
    }
    if (!isExpanded || e.key !== "Tab") return;
    const container = overlayContainerRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute("disabled")
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  // 토글 버튼 - "지금 이 아이콘이 곧 눌렀을 때 들어갈 모드"(옵시디언 관례).
  // edit -> read 전환은 blur와 마찬가지로 최신 초안을 바로 커밋한다(디바운스가
  // 아직 안 돌았을 수도 있는 텍스트가 렌더링 없이 그대로 남는 걸 막기 위해).
  function toggleMode() {
    setMode((cur) => {
      if (cur === "edit") {
        flushSave();
        return "read";
      }
      focusOnEditRef.current = true;
      return "edit";
    });
  }

  // isExpanded일 때는 이 편집기 하나만 패널(아일랜드) 밖으로 튀어나와 뷰포트
  // 기준 오버레이가 된다 - 패널 자체는 그대로 두고, 노트패드만 왼쪽 네비 레일
  // 경계(212px = SideRail.tsx의 w-rail 196px + 16px 여백, tailwind.config.ts의
  // rail: "196px")까지 넓어진다. md 미만(모바일 바텀시트)에서는 레일이 아예
  // 없으므로 전체화면으로 대체한다.
  // 두 타이포 스케일 중 지금 상태에 맞는 쪽을 고른다 - 제목 input, 본문
  // textarea, 렌더링된 마크다운 컨테이너 세 곳 모두 이 값 하나를 그대로 쓴다.
  const typeScale = isExpanded ? EXPANDED_TYPE_SCALE : COLLAPSED_TYPE_SCALE;

  // 이 편집기는 두 표면에서 재사용된다: 접힌 상태(패널 아코디언 안, 종이
  // 표면)와 확대 상태(z-[25] 전체화면 오버레이, 관측 표면 - 사용자 지시로
  // 잉크 유지). 레이아웃/기능은 그대로 두고 색 토큰만 이 스위치로 가른다.
  const textHi = isExpanded ? "text-text-hi" : "text-paper-ink";
  const textLo = isExpanded ? "text-text-lo" : "text-paper-lo";
  const ruleBorder = isExpanded ? "border-rule" : "border-paper-line";
  const focusOutline = isExpanded
    ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
    : "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink";
  const hoverBorder = isExpanded ? "hover:border-spec-b hover:text-text-hi" : "hover:border-paper-ink hover:text-paper-ink";

  const editorWrapperClass = isExpanded
    ? cn(
        "fixed inset-2 z-[25] flex flex-col gap-2.5 overflow-y-auto rounded-none border border-rule bg-ink-800/95 p-3.5 shadow-2xl backdrop-blur-md",
        "md:inset-auto md:left-[212px] md:right-4 md:top-4 md:bottom-4 md:w-auto",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
      )
    : "space-y-2.5";

  // 붙여넣기/⋯ 첨부 안내는 더 이상 별도 박스 줄이 아니라 본문이 비어 있을 때만
  // 보이는 placeholder다 - 옵시디언은 폼이 아니라 문서이므로, 안내문조차 그
  // 문서의 흐린 텍스트처럼 보여야 한다.
  const bodyPlaceholder =
    "내용을 마크다운으로 적어보세요. **굵게**, `코드`, [[원소 라벨]] 등을 쓸 수 있어요. 이미지는 붙여넣기(Ctrl+V)나 ⋯로 첨부할 수 있어요(최대 10MB).";

  // isExpanded 상태에서는 이 편집기를 document.body로 포탈한다. 부모 aside가
  // backdrop-blur-md(=backdrop-filter)를 갖고 있는데, backdrop-filter는
  // transform/filter와 마찬가지로 자손 fixed 요소의 containing block을
  // 자기 자신으로 바꿔버린다 - 그러면 여기 있는 "fixed; left:212px; right:16px"가
  // 뷰포트가 아니라 ~288px 너비의 aside 기준으로 계산되어, 오른쪽 끝에 붙은
  // ~60px 세로 슬리버가 된다(제목 글자가 한 자씩 줄바꿈되는 버그의 원인).
  // body로 포탈하면 fixed가 다시 뷰포트 기준이 된다. 접힌(비확장) 상태는
  // 그대로 패널 안 인라인 렌더링을 유지한다.
  // 확대(isExpanded) 상태에서는 오버레이 자체는 여전히 레일 경계까지 넓게
  // 펴지지만(212px~), 그 안의 글줄까지 그 폭을 다 채우면 옵시디언과 달리
  // 한 줄이 너무 길어져 읽기 힘들어진다 - 옵시디언은 넓은 창에서도 본문을
  // 화면 중앙의 좁은 단(칼럼)에 고정한다. 그래서 제목/본문/첨부만 최대
  // ~720px 중앙 정렬 칼럼으로 감싼다. 접힌 상태에서는 패널 자체가 이미
  // 좁으므로 감싸지 않고 기존 그대로 전체 폭을 쓴다.
  const contentColumn = (
    <>
      {/* 옵시디언 스타일: 폼이 아니라 한 장의 문서. 제목과 본문 사이에 테두리도
          배경 구분도 없다 - 처음 적는 줄이 곧 제목이다. 확대 버튼과 ⋮ 메뉴는
          더 이상 이 패드 위에 없다 - 행 헤더(부모)로 옮겨졌다. */}
      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={flushSave}
        placeholder="제목"
        style={{
          fontSize: typeScale.titleFontSize,
          fontWeight: typeScale.titleFontWeight,
          lineHeight: typeScale.titleLineHeight,
        }}
        className={cn(
          "w-full border-0 bg-transparent py-1 font-serif focus-visible:outline-none",
          textHi,
          isExpanded ? "placeholder:text-text-lo/60" : "placeholder:text-paper-lo/60"
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape") handleEscape();
          if (e.key === "Enter") {
            e.preventDefault();
            focusOnEditRef.current = true;
            setMode("edit");
          }
        }}
      />

      {/* 명시적 모드 토글(행 헤더/탭 바의 연필·책 버튼)이 mode를 정한다. "edit"는
          원문 textarea, "read"는 렌더링. blur는 더 이상 모드를 바꾸지 않는다 -
          자동저장만 하고 edit에 그대로 머문다(요청: sticky 모드). 렌더링 상태를
          클릭(또는 Enter)하면 편집으로 들어간다. 제목과 이어지는 한 장의 문서로
          보이도록 테두리/배경을 두지 않는다. */}
      {mode === "edit" ? (
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={flushSave}
          onPaste={handleBodyPaste}
          placeholder={bodyPlaceholder}
          rows={isExpanded ? 20 : 9}
          style={{ fontSize: typeScale.bodyFontSize, lineHeight: typeScale.bodyLineHeight }}
          className={cn(
            "w-full resize-none border-0 bg-transparent px-0 py-1 font-sans focus-visible:outline-none",
            textHi,
            isExpanded ? "placeholder:text-text-lo" : "placeholder:text-paper-lo"
          )}
          onKeyDown={(e) => {
            // Esc로 편집을 취소할 수 있어야 하지만(키보드로 빠져나가기), 캔버스의
            // 전역 Delete/Backspace 핸들러가 여기서 절대 발동하면 안 된다 - 이
            // textarea는 isTypingTarget 판정에 걸리므로 캔버스 쪽에서 이미
            // 무시하지만, 혹시 몰라 버블링도 막아 이중으로 방어한다.
            if (e.key === "Escape") handleEscape();
            if (e.key === "Delete" || e.key === "Backspace") e.stopPropagation();
          }}
        />
      ) : (
        <div
          onClick={enterEditMode}
          style={{ fontSize: typeScale.bodyFontSize, lineHeight: typeScale.bodyLineHeight }}
          className={cn(
            "min-h-[120px] cursor-text border-0 bg-transparent px-0 py-1 font-sans focus-visible:outline-none",
            textHi,
            isExpanded && "min-h-[320px]"
          )}
        >
          {body.trim() ? (
            <Markdown text={body} resolveLink={resolveLink} onLinkClick={onLinkClick} />
          ) : (
            <span className={textLo}>{bodyPlaceholder}</span>
          )}
          {attachments.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {attachments.map((att) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={att.id}
                  src={att.url}
                  alt={att.name}
                  className={cn("aspect-square w-full rounded-none border object-cover", ruleBorder)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => attachFiles(Array.from(e.target.files ?? []))}
      />
      {attachError && <p className="font-sans text-[11px] text-spec-m">{attachError}</p>}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div key={att.id} className={cn("group relative h-14 w-14 shrink-0 overflow-hidden rounded-none border", ruleBorder)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => handleRemoveAttachment(att.id)}
                aria-label={`${att.name} 첨부 삭제`}
                title="삭제"
                className={cn(
                  "absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-none bg-ink-900/80 font-sans text-[10px] text-text-hi hover:bg-spec-m",
                  focusOutline
                )}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const editorNode = (
    <div ref={overlayContainerRef} className={editorWrapperClass} onKeyDown={handleOverlayKeyDown}>
      {isExpanded && tabBar?.({ mode, onToggleMode: toggleMode })}
      {isExpanded ? (
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-2.5 pt-2">{contentColumn}</div>
      ) : (
        contentColumn
      )}

      {/* 공개/비공개·삭제·저장/취소는 전부 행 헤더의 ⋮ 메뉴 + 자동저장으로
          옮겨갔다 - 이 바닥 줄에는 편집 도구(첨부, 모드 토글)만 남는다. 모드
          토글은 접힌 상태에서만 여기 둔다 - 확대 상태에서는 같은 토글이 이미
          탭 바(⫿ 버튼 바로 왼쪽)에 있으므로 중복시키지 않는다. */}
      <div className={cn("flex items-center justify-end gap-1.5 pt-1", isExpanded && "mx-auto w-full max-w-[720px]")}>
        {!isExpanded && <NoteModeToggleButton mode={mode} onToggle={toggleMode} paper />}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="파일 탐색기에서 이미지 첨부"
          title="파일에서 첨부"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-none border font-sans text-xs leading-none",
            ruleBorder,
            textLo,
            hoverBorder,
            focusOutline
          )}
        >
          {"⋯"}
        </button>
      </div>
    </div>
  );

  if (isExpanded && typeof document !== "undefined") {
    return createPortal(editorNode, document.body);
  }
  return editorNode;
}

interface PickerSection {
  nodeId: string;
  label: string;
  code?: string | null;
  notes: ElementNote[];
}

interface NoteTabBarProps {
  elementLabel: string;
  elementCode?: string | null;
  tabs: NoteTabInfo[];
  activeTabKey: string | null;
  notesById: Map<string, ElementNote>;
  onSwitchTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  onCloseOverlay: () => void;
  pickerSections: PickerSection[];
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onPickNote: (nodeId: string, noteId: string) => void;
  onCreateNote: (nodeId: string) => void;
  /** 지금 활성 탭(노트)의 읽기/편집 모드 - 그 노트의 NoteEditor가 소유한
   * state를 그대로 받아 ⫿ 닫기 버튼 바로 왼쪽에 토글로 보여준다. */
  mode: NoteMode;
  onToggleMode: () => void;
}

/**
 * 확대된 편집기 맨 위의 옵시디언 스타일 탭 스트립 - 탭 칩들 + "+"(피커) +
 * 브레드크럼(요소 / 노트 제목) + 맨 오른쪽 닫기(축소) 버튼. 부모
 * (ElementNotesPanel)가 탭 목록/활성 탭을 소유하므로 이 컴포넌트는 순수
 * 표현 + 방향키 네비게이션만 담당한다.
 */
function NoteTabBar({
  elementLabel,
  elementCode,
  tabs,
  activeTabKey,
  notesById,
  onSwitchTab,
  onCloseTab,
  onCloseOverlay,
  pickerSections,
  pickerOpen,
  onPickerOpenChange,
  onPickNote,
  onCreateNote,
  mode,
  onToggleMode,
}: NoteTabBarProps) {
  const tabRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeNote = activeTabKey ? notesById.get(activeTabKey) : undefined;

  function focusTab(index: number) {
    if (tabs.length === 0) return;
    const wrapped = (index + tabs.length) % tabs.length;
    const tab = tabs[wrapped];
    onSwitchTab(tab.key);
    tabRefs.current[wrapped]?.focus();
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 border-b border-rule pb-2">
      <div role="tablist" aria-label="열린 노트 탭" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const note = notesById.get(tab.key);
          const selected = tab.key === activeTabKey;
          return (
            <div
              key={tab.key}
              role="tab"
              id={`note-tab-${tab.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              onClick={() => onSwitchTab(tab.key)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  focusTab(index + 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  focusTab(index - 1);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSwitchTab(tab.key);
                }
              }}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-none border px-2 py-1 font-sans text-xs",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b",
                selected
                  ? "border-spec-b bg-ink-700 text-text-hi"
                  : "border-rule text-text-lo hover:border-spec-b hover:text-text-hi"
              )}
            >
              <span className="max-w-[9rem] truncate">{note?.title || "무제"}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${note?.title || "무제"} 탭 닫기`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.key);
                }}
                className="shrink-0 text-text-lo hover:text-spec-m"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* "+" 피커는 일부러 위 role="tablist" 바깥(형제)에 둔다 - 그 안은
          overflow-x-auto라서(탭이 많아지면 가로 스크롤) 브라우저가 다른 축도
          클립 대상으로 취급해(overflow-x/-y 중 하나만 visible이 아니면 나머지도
          auto로 강제되는 CSS 규칙) 그 안에 절대 위치로 펼쳐지는 드롭다운이
          세로로 잘려 "빈 막대"처럼 보이는 버그가 있었다. 바깥(이 줄의 overflow
          없는 flex row)에 두면 팝업이 온전히 펼쳐진다. */}
      <NoteTabPicker
        sections={pickerSections}
        openKeys={new Set(tabs.map((t) => t.key))}
        isOpen={pickerOpen}
        onOpenChange={onPickerOpenChange}
        onPick={onPickNote}
        onCreateNote={onCreateNote}
      />

      <div className="min-w-0 shrink truncate font-sans text-xs text-text-lo">
        <span className="text-text-hi">{elementLabel}</span>
        {elementCode && <span className="ml-1 font-mono text-[11px]">{elementCode}</span>}
        <span className="mx-1">/</span>
        <span>{activeNote?.title || "무제"}</span>
      </div>

      <NoteModeToggleButton mode={mode} onToggle={onToggleMode} />

      <button
        type="button"
        aria-label="노트 축소"
        onClick={onCloseOverlay}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-rule text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
      >
        {/* 확대 토글과 동일한 사이드 패널 글리프 - "같은 스위치가 꺼진다"는 것을
            시각적으로 보여준다. */}
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <rect x="1" y="1.5" width="11" height="10" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8.3 1.5v10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

interface NoteTabPickerProps {
  sections: PickerSection[];
  openKeys: Set<string>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (nodeId: string, noteId: string) => void;
  /** 원소별 "＋ 새 노트" 행 - 노트가 0개인 원소에도 항상 나타나므로, 노트가
   * 하나도 없는 원소에도 이 피커에서 바로 첫 노트를 만들 수 있다. */
  onCreateNote: (nodeId: string) => void;
}

/**
 * "+" 버튼 - 원소 -> 그 원소의 노트들을 나열하는 작은 팝업. 이미 탭으로 열려
 * 있는 노트는 흐리게 표시하고 클릭해도 그 탭을 활성화만 한다(중복 탭 없음).
 * 각 원소 섹션 맨 아래에는 "＋ 새 노트" 행이 항상 있다(노트가 0개인 원소도
 * 포함) - 여기서 바로 새 노트를 만들어 그 자리에서 탭으로 연다.
 */
function NoteTabPicker({ sections, openKeys, isOpen, onOpenChange, onPick, onCreateNote }: NoteTabPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const flatItems = useMemo(
    () => sections.flatMap((s) => s.notes.map((n) => ({ nodeId: s.nodeId, noteId: n.id }))),
    [sections]
  );

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, onOpenChange]);

  function focusItem(index: number) {
    if (flatItems.length === 0) return;
    const wrapped = (index + flatItems.length) % flatItems.length;
    itemRefs.current[wrapped]?.focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="다른 노트를 탭으로 열기"
        onClick={() => onOpenChange(!isOpen)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-dashed border-rule font-sans text-xs text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
      >
        +
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="노트 열기"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onOpenChange(false);
            }
          }}
          className="absolute left-0 top-full z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-none border border-rule bg-ink-800 py-1 shadow-lg"
        >
          {sections.length === 0 && (
            <p className="px-2.5 py-1.5 font-sans text-[11px] text-text-lo">캔버스에 원소가 없어요.</p>
          )}
          {sections.map((section) => (
            <div key={section.nodeId}>
              <div className="px-2.5 pt-1.5 font-sans text-[10px] uppercase tracking-wide text-text-lo">
                {section.label}
              </div>
              {section.notes.length === 0 && (
                <p className="px-2.5 py-1 font-sans text-[11px] text-text-lo">노트가 아직 없어요.</p>
              )}
              {section.notes.map((note) => {
                const already = openKeys.has(note.id);
                const flatIndex = flatItems.findIndex((f) => f.noteId === note.id);
                return (
                  <button
                    key={note.id}
                    type="button"
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[flatIndex] = el;
                    }}
                    onClick={() => onPick(section.nodeId, note.id)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        focusItem(flatIndex + 1);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        focusItem(flatIndex - 1);
                      }
                    }}
                    className={cn(
                      "block w-full truncate rounded-none px-2.5 py-1.5 text-left font-sans text-xs hover:bg-ink-700",
                      already ? "text-text-lo/60" : "text-text-hi"
                    )}
                  >
                    {note.title || "무제"}
                    {already && " · 열림"}
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                onClick={() => onCreateNote(section.nodeId)}
                className="block w-full truncate rounded-none px-2.5 py-1.5 text-left font-sans text-xs text-spec-b hover:bg-ink-700"
              >
                {"＋ 새 노트"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "+ 새 노트" 흐름 전용 래퍼 - 노트가 아직 존재하지 않으므로 첫 번째
 * 유의미한 자동저장에서 onCreateNote를 호출해 id를 받고, 그 뒤로는 같은
 * id로 onUpdateNote를 호출해 이어간다. 아직 아무것도 안 적었으면(전부
 * 공백) NoteEditor의 flushSave가 애초에 onPersist를 부르지 않으므로 빈
 * 노트가 생기지 않는다.
 */
function NewNoteEditor({
  nodeId,
  onCreateNote,
  onUpdateNote,
  onClose,
  resolveLink,
  onLinkClick,
  isExpanded,
  onExpandedChange,
}: {
  nodeId: string;
  onCreateNote: ElementNotesPanelProps["onCreateNote"];
  onUpdateNote: ElementNotesPanelProps["onUpdateNote"];
  onClose: () => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const createdIdRef = useRef<string | null>(null);
  return (
    <NoteEditor
      initial={{ title: "", body: "", attachments: [] }}
      isPublic={false}
      onClose={onClose}
      resolveLink={resolveLink}
      onLinkClick={onLinkClick}
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      isNewNote
      onPersist={(input) => {
        if (createdIdRef.current) {
          onUpdateNote(createdIdRef.current, input);
        } else {
          createdIdRef.current = onCreateNote(nodeId, input);
        }
      }}
    />
  );
}

interface NoteKebabMenuProps {
  isPublic: boolean;
  createdAt: number;
  onTogglePublic: () => void;
  onDelete: () => void;
}

/**
 * 세로 점 세 개(⋮) 메뉴 - 공개/비공개 전환, 삭제, 그리고(행 헤더에서 밀려난)
 * 만든 날짜를 비활성 텍스트로 보여준다. 요청 6: "온갖 부가적인 잡다한
 * 옵션들은 세로 쩜쩜쩜으로".
 */
function NoteKebabMenu({ isPublic, createdAt, onTogglePublic, onDelete }: NoteKebabMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="노트 옵션 더보기"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-none border border-paper-line text-paper-lo hover:border-paper-ink hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="2" r="1" fill="currentColor" />
          <circle cx="6.5" cy="6.5" r="1" fill="currentColor" />
          <circle cx="6.5" cy="11" r="1" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="노트 옵션"
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-none border border-paper-line bg-paper py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onTogglePublic();
              setOpen(false);
            }}
            className="block w-full rounded-none px-2.5 py-1.5 text-left font-sans text-xs text-paper-ink hover:bg-paper-soft"
          >
            {isPublic ? "비공개로 전환" : "공개로 전환"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="block w-full rounded-none px-2.5 py-1.5 text-left font-sans text-xs text-spec-m hover:bg-paper-soft"
          >
            삭제
          </button>
          <div className="mt-1 border-t border-paper-line px-2.5 pt-1.5 font-mono text-[10px] text-paper-lo" aria-hidden="true">
            {formatUpdatedAt(createdAt)} 생성
          </div>
        </div>
      )}
    </div>
  );
}
