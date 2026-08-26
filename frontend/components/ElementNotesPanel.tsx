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

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { CanvasNode } from "@/components/ConstellationCanvas";
import { Markdown, type ResolveWikiLink } from "@/lib/markdown";

export interface ElementNote {
  id: string;
  nodeId: string;
  title: string;
  body: string;
  /** 기본값은 항상 false(비공개) - 실수로 공개되는 것이 실수로 비공개인 것보다
   * 훨씬 나쁘므로, 새 노트는 명시적으로 체크하지 않는 한 비공개로 시작한다. */
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
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
  onCreateNote: (nodeId: string, input: { title: string; body: string; isPublic: boolean }) => void;
  onUpdateNote: (id: string, patch: { title: string; body: string; isPublic: boolean }) => void;
  onDeleteNote: (id: string) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
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
            <div key={node.id} className="rounded-md border border-rule bg-ink-900/60">
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
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
                    className="w-full rounded-md border border-dashed border-rule px-2.5 py-1.5 text-left font-sans text-xs text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                  >
                    {"+ 새 노트"}
                  </button>

                  {activeNoteKey === newNoteKey && (
                    <NoteEditor
                      initial={{ title: "", body: "", isPublic: false }}
                      onCancel={() => setActiveNoteKey(null)}
                      resolveLink={resolveLink}
                      onLinkClick={onLinkClick}
                      onSave={(input) => {
                        onCreateNote(node.id, input);
                        setActiveNoteKey(null);
                      }}
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
                        <div key={note.id} className="rounded-md border border-rule bg-ink-800/60">
                          <div className="flex items-center gap-2 px-2.5 py-1.5">
                            <button
                              type="button"
                              id={noteBarId}
                              aria-expanded={noteOpen}
                              aria-controls={noteRegionId}
                              onClick={() => setActiveNoteKey(noteOpen ? null : note.id)}
                              className="min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                            >
                              <div className="truncate font-sans text-xs font-medium text-text-hi">
                                {note.title || "(제목 없음)"}
                              </div>
                              <div className="truncate font-sans text-[10px] text-text-lo">
                                {previewOf(note.body) || "내용 없음"}
                              </div>
                            </button>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] leading-none",
                                note.isPublic ? "bg-spec-g/20 text-spec-g" : "bg-ink-700 text-text-lo"
                              )}
                              title={note.isPublic ? "공개 노트" : "비공개 노트"}
                            >
                              {note.isPublic ? "공개" : "비공개"}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-text-lo">
                              {formatUpdatedAt(note.updatedAt)}
                            </span>
                            <button
                              type="button"
                              onClick={() => onDeleteNote(note.id)}
                              className="shrink-0 rounded px-1.5 py-0.5 font-sans text-[11px] text-text-lo hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
                            >
                              삭제
                            </button>
                          </div>
                          {noteOpen && (
                            <div
                              id={noteRegionId}
                              role="region"
                              aria-labelledby={noteBarId}
                              className="border-t border-rule px-2.5 py-2"
                            >
                              <NoteEditor
                                initial={{ title: note.title, body: note.body, isPublic: note.isPublic }}
                                onCancel={() => setActiveNoteKey(null)}
                                resolveLink={resolveLink}
                                onLinkClick={onLinkClick}
                                onSave={(input) => {
                                  onUpdateNote(note.id, input);
                                  setActiveNoteKey(null);
                                }}
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
  initial: { title: string; body: string; isPublic: boolean };
  onCancel: () => void;
  onSave: (input: { title: string; body: string; isPublic: boolean }) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
}

function NoteEditor({ initial, onCancel, onSave, resolveLink, onLinkClick }: NoteEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [isPublic, setIsPublic] = useState(initial.isPublic);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="space-y-2.5">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        className="w-full rounded-md border border-rule bg-ink-900 px-2.5 py-1.5 font-sans text-sm text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />

      <div className="flex gap-1.5 font-sans text-[11px]">
        <button
          type="button"
          onClick={() => setShowPreview(false)}
          className={cn(
            "rounded px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b",
            !showPreview ? "bg-ink-700 text-text-hi" : "text-text-lo hover:text-text-hi"
          )}
        >
          편집
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className={cn(
            "rounded px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b",
            showPreview ? "bg-ink-700 text-text-hi" : "text-text-lo hover:text-text-hi"
          )}
        >
          미리보기
        </button>
      </div>

      {showPreview ? (
        <div className="min-h-[120px] rounded-md border border-rule bg-ink-900 px-2.5 py-2 font-sans text-xs text-text-hi">
          <Markdown text={body} resolveLink={resolveLink} onLinkClick={onLinkClick} />
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"내용을 마크다운으로 적어보세요. **굵게**, `코드`, [[원소 라벨]] 등을 쓸 수 있어요."}
          rows={7}
          className="w-full resize-none rounded-md border border-rule bg-ink-900 px-2.5 py-2 font-sans text-xs leading-relaxed text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          onKeyDown={(e) => {
            // Esc로 편집을 취소할 수 있어야 하지만(키보드로 빠져나가기), 캔버스의
            // 전역 Delete/Backspace 핸들러가 여기서 절대 발동하면 안 된다 - 이
            // textarea는 isTypingTarget 판정에 걸리므로 캔버스 쪽에서 이미
            // 무시하지만, 혹시 몰라 버블링도 막아 이중으로 방어한다.
            if (e.key === "Escape") onCancel();
            if (e.key === "Delete" || e.key === "Backspace") e.stopPropagation();
          }}
        />
      )}

      <label className="flex items-center gap-2 font-sans text-xs text-text-lo">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-rule accent-spec-b focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        />
        <span>
          {isPublic ? "공개 노트 (다른 사람이 볼 수 있어요)" : "비공개 노트 (나만 볼 수 있어요)"}
        </span>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1.5 font-sans text-xs text-text-lo hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onSave({ title: title.trim() || "(제목 없음)", body, isPublic })}
          className="rounded bg-spec-b px-2.5 py-1.5 font-sans text-xs font-medium text-ink-900 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-hi"
        >
          저장
        </button>
      </div>
    </div>
  );
}
