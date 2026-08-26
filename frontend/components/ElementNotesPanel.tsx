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

import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
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

// ConstellationCanvas.tsx의 TYPE_COLOR(항성 분광형 악센트)와 시각적으로 맞춘
// 값. 캔버스 컴포넌트는 이 매핑을 export하지 않으므로(내부 렌더링 전용 상수),
// ElementBinPanel.tsx가 이미 하듯 여기서도 최소한만 복제해 둔다 - 세 곳(캔버스
// 노드/보관함 칩/이 패널의 원소 바)의 점 색이 어긋나면 안 되므로.
const TYPE_DOT: Record<string, string> = {
  course: "var(--spec-b)",
  certification: "var(--spec-a)",
  organization: "var(--spec-g)",
  activity: "var(--spec-k)",
  networking: "var(--spec-m)",
};
const DEFAULT_DOT = "var(--text-lo)";

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
  // "확대 버튼으로 노트를 연 것"이라는 의도를 activeNoteKey가 바뀐 뒤(커밋 후)
  // 실행되는 아래 리셋 effect에 전달하기 위한 값 - 없으면 그 effect가 매번
  // false로 덮어써서 확대 버튼이 두 번 클릭해야 먹는 버그가 생긴다.
  const expandIntentRef = useRef<string | null>(null);

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
      onNoteExpandedChange(true);
      return;
    }
    expandIntentRef.current = null;
    onNoteExpandedChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteKey]);

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
        <p className="px-3 py-6 text-center font-sans text-body-sm leading-relaxed text-text-lo">
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
            <div key={node.id} className="rounded-none border border-rule bg-ink-900/60">
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
                className="flex w-full items-center gap-2 rounded-none px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TYPE_DOT[node.type] ?? DEFAULT_DOT }}
                />
                <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-text-hi">
                  {node.label}
                </span>
                {node.code && <span className="shrink-0 font-mono text-[11px] text-text-lo">{node.code}</span>}
                <span className="shrink-0 font-sans text-[11px] text-text-lo">{notes.length}개</span>
                <span
                  aria-hidden
                  className={cn("shrink-0 text-text-lo transition-transform", isOpen && "rotate-90")}
                >
                  {"›"}
                </span>
              </button>

              {isOpen && (
                <div id={regionId} role="region" aria-labelledby={barId} className="space-y-1.5 border-t border-rule px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setActiveNoteKey((cur) => (cur === newNoteKey ? null : newNoteKey))}
                    className="w-full rounded-none border border-dashed border-rule px-2.5 py-1.5 text-left font-sans text-xs text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
                      onLinkClick={onLinkClick}
                      isExpanded={isNoteExpanded}
                      onExpandedChange={onNoteExpandedChange}
                    />
                  )}

                  {notes.length === 0 ? (
                    <p className="px-1 py-4 text-center font-sans text-[11px] leading-relaxed text-text-lo">
                      아직 노트가 없어요. 여기서 배운 걸 처음으로 적어보세요.
                    </p>
                  ) : (
                    notes.map((note) => {
                      const noteOpen = activeNoteKey === note.id;
                      const noteRegionId = `note-region-${note.id}`;
                      const noteBarId = `note-bar-${note.id}`;
                      return (
                        <div key={note.id} className="rounded-none border border-rule bg-ink-800/60">
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
                              className="min-w-0 flex-1 rounded-none text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                            >
                              <div className="font-sans text-sm font-bold text-text-hi">
                                {note.title || "무제"}
                              </div>
                              <div className="truncate font-sans text-[10px] text-text-lo">
                                {previewOf(note.body) || "내용 없음"}
                              </div>
                            </button>
                            <button
                              type="button"
                              aria-pressed={noteOpen && isNoteExpanded}
                              aria-label={noteOpen && isNoteExpanded ? "노트 축소" : "노트 확대"}
                              onClick={() => {
                                if (!noteOpen) {
                                  expandIntentRef.current = note.id;
                                  setActiveNoteKey(note.id);
                                  onNoteExpandedChange(true);
                                } else {
                                  onNoteExpandedChange(!isNoteExpanded);
                                }
                              }}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-rule text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
                              className="border-t border-rule px-2.5 py-2"
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
                                onLinkClick={onLinkClick}
                                isExpanded={isNoteExpanded}
                                onExpandedChange={onNoteExpandedChange}
                                onPersist={(input) => onUpdateNote(note.id, input)}
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
}: NoteEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  // 옵시디언처럼 모드 버튼이 없다 - 본문에 포커스가 있으면 원문(마크다운)을
  // 편집하고, 포커스를 잃으면 그 자리에서 바로 렌더링된다. 새 노트(본문 없음)는
  // 바로 타이핑할 수 있게 편집 상태로 시작, 기존 노트는 읽는 상태로 시작한다.
  const [isBodyFocused, setIsBodyFocused] = useState(initial.body.trim() === "");
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
    setIsBodyFocused(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // isExpanded일 때는 이 편집기 하나만 패널(아일랜드) 밖으로 튀어나와 뷰포트
  // 기준 오버레이가 된다 - 패널 자체는 그대로 두고, 노트패드만 왼쪽 네비 레일
  // 경계(212px = SideRail.tsx의 w-rail 196px + 16px 여백, tailwind.config.ts의
  // rail: "196px")까지 넓어진다. md 미만(모바일 바텀시트)에서는 레일이 아예
  // 없으므로 전체화면으로 대체한다.
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
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={flushSave}
        placeholder="제목"
        className="w-full border-0 bg-transparent py-1 font-serif text-display font-bold text-text-hi placeholder:text-text-lo/60 focus-visible:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") handleEscape();
          if (e.key === "Enter") {
            e.preventDefault();
            setIsBodyFocused(true);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        }}
      />

      {/* 옵시디언처럼 모드 버튼이 없다 - 포커스가 있으면 원문, 없으면 렌더링.
          렌더링 상태를 클릭(또는 Enter)하면 다시 편집으로 들어간다. 제목과
          이어지는 한 장의 문서로 보이도록 테두리/배경을 두지 않는다. */}
      {isBodyFocused ? (
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => {
            setIsBodyFocused(false);
            flushSave();
          }}
          onPaste={handleBodyPaste}
          placeholder={bodyPlaceholder}
          rows={isExpanded ? 20 : 9}
          className="w-full resize-none border-0 bg-transparent px-0 py-1 font-sans text-xs leading-relaxed text-text-hi placeholder:text-text-lo focus-visible:outline-none"
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
          role="button"
          tabIndex={0}
          aria-label="노트 본문 - 클릭하면 편집"
          onClick={enterEditMode}
          onKeyDown={(e) => {
            if (e.key === "Enter") enterEditMode();
            if (e.key === "Escape") handleEscape();
          }}
          className={cn(
            "min-h-[120px] cursor-text border-0 bg-transparent px-0 py-1 font-sans text-xs text-text-hi focus-visible:outline-none",
            isExpanded && "min-h-[320px]"
          )}
        >
          {body.trim() ? (
            <Markdown text={body} resolveLink={resolveLink} onLinkClick={onLinkClick} />
          ) : (
            <span className="text-text-lo">{bodyPlaceholder}</span>
          )}
          {attachments.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {attachments.map((att) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={att.id}
                  src={att.url}
                  alt={att.name}
                  className="aspect-square w-full rounded-none border border-rule object-cover"
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
            <div key={att.id} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-none border border-rule">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => handleRemoveAttachment(att.id)}
                aria-label={`${att.name} 첨부 삭제`}
                title="삭제"
                className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-none bg-ink-900/80 font-sans text-[10px] text-text-hi hover:bg-spec-m focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
    <div className={editorWrapperClass}>
      {isExpanded ? (
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-2.5 pt-2">{contentColumn}</div>
      ) : (
        contentColumn
      )}

      {/* 공개/비공개·삭제·저장/취소는 전부 행 헤더의 ⋮ 메뉴 + 자동저장으로
          옮겨갔다 - 이 바닥 줄에는 편집 도구인 첨부 버튼만 남는다. */}
      <div className={cn("flex items-center justify-end pt-1", isExpanded && "mx-auto w-full max-w-[720px]")}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="파일 탐색기에서 이미지 첨부"
          title="파일에서 첨부"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-rule font-sans text-xs leading-none text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
        className="flex h-6 w-6 items-center justify-center rounded-none border border-rule text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-none border border-rule bg-ink-800 py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onTogglePublic();
              setOpen(false);
            }}
            className="block w-full rounded-none px-2.5 py-1.5 text-left font-sans text-xs text-text-hi hover:bg-ink-700"
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
            className="block w-full rounded-none px-2.5 py-1.5 text-left font-sans text-xs text-spec-m hover:bg-ink-700"
          >
            삭제
          </button>
          <div className="mt-1 border-t border-rule px-2.5 pt-1.5 font-mono text-[10px] text-text-lo" aria-hidden="true">
            {formatUpdatedAt(createdAt)} 생성
          </div>
        </div>
      )}
    </div>
  );
}
