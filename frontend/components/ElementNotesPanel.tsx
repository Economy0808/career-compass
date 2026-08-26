"use client";

/**
 * 원소 노트 패널 - 오른쪽 패널이 「군집」에서 「노트」로 바뀐 상태.
 *
 * 새 영역을 여는 게 아니라 ElementBinPanel과 같은 자리(같은 fixed 오버레이
 * 위치/치수)를 그대로 대체한다 - onOpenNotes(nodeId)는 새 창을 띄우는 게
 * 아니라 이 패널이 그 위치에서 「보관함 -> 노트」로 스왑되는 신호다.
 *
 * 노트 자체는 이 컴포넌트가 소유하지 않는다 - 상태는 부모(page.tsx)의
 * React state에 그래프와 나란히 산다(백엔드 연동 전 데모라 새로고침하면
 * 사라진다). 이 컴포넌트는 순수 표현 계층 + 편집 폼 로컬 상태만 가진다.
 */

import { useEffect, useMemo, useState } from "react";
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
  node: CanvasNode;
  notes: ElementNote[];
  onBack: () => void;
  onCreateNote: (input: { title: string; body: string; isPublic: boolean }) => void;
  onUpdateNote: (id: string, patch: { title: string; body: string; isPublic: boolean }) => void;
  onDeleteNote: (id: string) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
  className?: string;
}

type ViewState = { mode: "list" } | { mode: "new" } | { mode: "edit"; noteId: string };

function formatUpdatedAt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewOf(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}

export function ElementNotesPanel({
  node,
  notes,
  onBack,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  resolveLink,
  onLinkClick,
  className,
}: ElementNotesPanelProps) {
  const [view, setView] = useState<ViewState>({ mode: "list" });

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  // 노드가 바뀌면(다른 원소의 노트로 전환) 항상 목록으로 리셋한다 - 편집 폼이
  // 이전 원소의 노트를 가리킨 채로 남아있으면 안 되므로.
  useEffect(() => {
    setView({ mode: "list" });
  }, [node.id]);

  return (
    <aside
      className={cn(
        "fixed z-20 flex flex-col overflow-hidden rounded-xl border border-rule bg-ink-800/95 shadow-lg backdrop-blur-md",
        "inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] max-h-[46vh]",
        "md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:h-auto md:max-h-none md:w-72",
        className
      )}
      aria-label={`${node.label} 노트`}
    >
      <div className="flex items-center gap-2 border-b border-rule px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded px-1.5 py-1 font-sans text-xs text-text-lo hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          aria-label="군집 보관함으로 돌아가기"
        >
          {"‹ 군집"}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-body-sm font-bold text-text-hi">{node.label}</div>
          {node.code && <div className="font-mono text-[11px] leading-none text-text-lo">{node.code}</div>}
        </div>
      </div>

      <div className="canvas-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
        {view.mode === "list" && (
          <NoteList
            notes={sortedNotes}
            onNew={() => setView({ mode: "new" })}
            onEdit={(id) => setView({ mode: "edit", noteId: id })}
            onDelete={onDeleteNote}
            resolveLink={resolveLink}
            onLinkClick={onLinkClick}
          />
        )}
        {view.mode === "new" && (
          <NoteEditor
            initial={{ title: "", body: "", isPublic: false }}
            onCancel={() => setView({ mode: "list" })}
            resolveLink={resolveLink}
            onLinkClick={onLinkClick}
            onSave={(input) => {
              onCreateNote(input);
              setView({ mode: "list" });
            }}
          />
        )}
        {view.mode === "edit" &&
          (() => {
            const target = notes.find((n) => n.id === view.noteId);
            if (!target) {
              setView({ mode: "list" });
              return null;
            }
            return (
              <NoteEditor
                initial={{ title: target.title, body: target.body, isPublic: target.isPublic }}
                onCancel={() => setView({ mode: "list" })}
                resolveLink={resolveLink}
                onLinkClick={onLinkClick}
                onSave={(input) => {
                  onUpdateNote(target.id, input);
                  setView({ mode: "list" });
                }}
              />
            );
          })()}
      </div>
    </aside>
  );
}

interface NoteListProps {
  notes: ElementNote[];
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  resolveLink: ResolveWikiLink;
  onLinkClick: (nodeId: string) => void;
}

function NoteList({ notes, onNew, onEdit, onDelete, resolveLink, onLinkClick }: NoteListProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onNew}
        className="w-full rounded-md border border-dashed border-rule px-3 py-2 text-left font-sans text-xs text-text-lo hover:border-spec-b hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
      >
        {"+ 새 노트"}
      </button>

      {notes.length === 0 ? (
        <p className="px-1 py-6 text-center font-sans text-body-sm leading-relaxed text-text-lo">
          아직 노트가 없어요. 여기서 배운 걸 처음으로 적어보세요.
        </p>
      ) : (
        notes.map((note) => (
          <div
            key={note.id}
            className="rounded-md border border-rule bg-ink-900/60 p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onEdit(note.id)}
                className="min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
              >
                <div className="truncate font-sans text-sm font-medium text-text-hi">
                  {note.title || "(제목 없음)"}
                </div>
                <div className="mt-0.5 truncate font-sans text-[11px] text-text-lo">
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
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] text-text-lo">{formatUpdatedAt(note.updatedAt)}</span>
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                className="rounded px-1.5 py-0.5 font-sans text-[11px] text-text-lo hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
              >
                삭제
              </button>
            </div>
            {/* 목록에서도 본문 일부를 렌더링해 위키링크/서식이 눈에 보이게 한다. */}
            <div className="mt-1.5 border-t border-rule pt-1.5 font-sans text-[11px] text-text-lo">
              <Markdown text={previewOf(note.body)} resolveLink={resolveLink} onLinkClick={onLinkClick} />
            </div>
          </div>
        ))
      )}
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
