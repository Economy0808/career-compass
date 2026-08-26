"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { DayCompleteCelebration } from "@/components/DayCompleteCelebration";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { Button, Card, CloseIcon, EmptyState, Field, PlusIcon } from "@/components/ui";
import {
  createTodoCategory,
  createTodoItem,
  deleteTodoCategory,
  deleteTodoItem,
  getTodoCalendar,
  getTodoDay,
  patchTodoCategory,
  patchTodoItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import { celebrateCheck } from "@/lib/feedback";
import { todayISODate } from "@/lib/format";
import type { CalendarDayOut, TodoCategoryOut, TodoColor, TodoItemOut } from "@/lib/types";

// 분류 색은 사용자가 고르는 데이터라 디자인 토큰이 아닌 고정 팔레트를 쓴다.
const COLOR_HEX: Record<TodoColor, string> = {
  green: "#5db35b",
  sky: "#6aa9d8",
  gold: "#e2b94f",
  coral: "#df8c72",
  violet: "#a78bd0",
  brown: "#b08a5a",
};
const COLORS = Object.keys(COLOR_HEX) as TodoColor[];

export default function SchedulePage() {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();

  const initial = todayISODate();
  const [selectedDate, setSelectedDate] = useState(initial);
  const [viewYear, setViewYear] = useState(Number(initial.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(initial.slice(5, 7)));

  const [categories, setCategories] = useState<TodoCategoryOut[]>([]);
  const [items, setItems] = useState<TodoItemOut[]>([]);
  const [calendar, setCalendar] = useState<Record<string, CalendarDayOut>>({});
  const [loading, setLoading] = useState(true);
  const [addingCategory, setAddingCategory] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  // 하루 완료 목표 (캘린더 콩 최대치와 동일)
  const DAY_GOAL = 6;

  useEffect(() => {
    if (!authLoading && !me) router.push("/login");
  }, [authLoading, me, router]);

  // 선택일의 할 일 + 분류 로드
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    setLoading(true);
    getTodoDay(selectedDate)
      .then((day) => {
        if (cancelled) return;
        setCategories(day.categories);
        setItems(day.items);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, me]);

  // 보이는 달의 캘린더 집계 로드
  const reloadCalendar = useCallback(() => {
    if (!me) return;
    getTodoCalendar(viewYear, viewMonth).then((cells) => {
      setCalendar(Object.fromEntries(cells.map((c) => [c.date, c])));
    });
  }, [me, viewYear, viewMonth]);

  useEffect(() => {
    reloadCalendar();
  }, [reloadCalendar]);

  // 선택일의 콩 카운트를 로컬 items로부터 즉시 갱신(낙관적)
  function syncCalendarCell(nextItems: TodoItemOut[]) {
    const completed = nextItems.filter((i) => i.is_completed).length;
    setCalendar((prev) => ({
      ...prev,
      [selectedDate]: {
        date: selectedDate,
        completed_count: completed,
        total_count: nextItems.length,
      },
    }));
  }

  async function toggleItem(item: TodoItemOut) {
    const next = !item.is_completed;
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, is_completed: next } : i));
    const completed = nextItems.filter((i) => i.is_completed).length;
    if (next) {
      // 하루 6개 달성 순간엔 축하 팡파레, 그 외엔 짧은 "띠링"
      if (completed === DAY_GOAL) setCelebrating(true);
      else celebrateCheck();
    }
    setItems(nextItems);
    syncCalendarCell(nextItems);
    try {
      await patchTodoItem(item.id, { is_completed: next });
    } catch {
      setItems(items);
      syncCalendarCell(items);
    }
  }

  async function addItem(categoryId: number, content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    const created = await createTodoItem(categoryId, selectedDate, trimmed);
    const nextItems = [...items, created];
    setItems(nextItems);
    syncCalendarCell(nextItems);
  }

  async function removeItem(item: TodoItemOut) {
    const nextItems = items.filter((i) => i.id !== item.id);
    setItems(nextItems);
    syncCalendarCell(nextItems);
    await deleteTodoItem(item.id);
  }

  async function addCategory(name: string, color: TodoColor) {
    const created = await createTodoCategory(name, color);
    setCategories((prev) => [...prev, created]);
    setAddingCategory(false);
  }

  async function renameCategory(id: number, name: string, color: TodoColor) {
    const updated = await patchTodoCategory(id, { name, color });
    setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  async function removeCategory(id: number) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setItems((prev) => {
      const nextItems = prev.filter((i) => i.category_id !== id);
      syncCalendarCell(nextItems);
      return nextItems;
    });
    await deleteTodoCategory(id);
  }

  const itemsByCategory = useMemo(() => {
    const map: Record<number, TodoItemOut[]> = {};
    for (const c of categories) map[c.id] = [];
    for (const i of items) (map[i.category_id] ??= []).push(i);
    return map;
  }, [categories, items]);

  function changeMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
  }

  if (authLoading || !me) {
    return (
      <div className="mx-auto max-w-sm animate-pulse">
        <EmptyState title="불러오는 중…" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-serif text-display font-bold text-content-primary">일정</h1>
      <p className="mt-2 text-body-sm text-content-muted">
        하루의 할 일을 콩으로 채워보세요 — 완료할수록 그날의 콩이 진해져요
      </p>

      <div className="mt-6">
        <ScheduleCalendar
          year={viewYear}
          month={viewMonth}
          selectedDate={selectedDate}
          data={calendar}
          onSelectDate={setSelectedDate}
          onPrevMonth={() => changeMonth(-1)}
          onNextMonth={() => changeMonth(1)}
        />
      </div>

      <div className="mb-3 mt-8 flex items-center gap-3">
        <h2 className="font-serif text-heading font-bold text-content-primary">
          {selectedDate.replace(/-/g, ".")}
        </h2>
        {!addingCategory && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setAddingCategory(true)}
          >
            <PlusIcon size={14} />
            분류 추가
          </Button>
        )}
      </div>

      {addingCategory && (
        <CategoryEditor onSave={addCategory} onCancel={() => setAddingCategory(false)} />
      )}

      {loading ? (
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-line bg-surface-raised"
            />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          title="아직 분류가 없어요."
          description="'분류 추가'로 학교·자격증처럼 나만의 묶음을 만들어보세요."
        />
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {categories.map((category) => (
            <CategorySection
              key={category.id}
              category={category}
              items={itemsByCategory[category.id] ?? []}
              onToggleItem={toggleItem}
              onAddItem={(content) => addItem(category.id, content)}
              onRemoveItem={removeItem}
              onRename={renameCategory}
              onDelete={() => removeCategory(category.id)}
            />
          ))}
        </div>
      )}

      {celebrating && <DayCompleteCelebration onDone={() => setCelebrating(false)} />}
    </div>
  );
}

// ---------- 분류 섹션 ----------

interface CategorySectionProps {
  category: TodoCategoryOut;
  items: TodoItemOut[];
  onToggleItem: (item: TodoItemOut) => void;
  onAddItem: (content: string) => void;
  onRemoveItem: (item: TodoItemOut) => void;
  onRename: (id: number, name: string, color: TodoColor) => void;
  onDelete: () => void;
}

function CategorySection({
  category,
  items,
  onToggleItem,
  onAddItem,
  onRemoveItem,
  onRename,
  onDelete,
}: CategorySectionProps) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const hex = COLOR_HEX[category.color];

  return (
    <Card>
      {editing ? (
        <CategoryEditor
          initialName={category.name}
          initialColor={category.color}
          onSave={(name, color) => {
            onRename(category.id, name, color);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onDelete={onDelete}
        />
      ) : (
        <div className="mb-2 flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: hex }} />
          <span className="min-w-0 truncate text-body-sm font-bold text-content-primary">
            {category.name}
          </span>
          <span className="shrink-0 text-micro text-content-muted">
            {items.filter((i) => i.is_completed).length}/{items.length}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto shrink-0 text-caption text-content-muted transition-colors hover:text-content-secondary"
          >
            편집
          </button>
        </div>
      )}

      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2.5 py-1.5">
            <TaskCheckbox checked={item.is_completed} onToggle={() => onToggleItem(item)} />
            <span
              className={cn(
                "min-w-0 flex-1 break-words text-body-sm",
                item.is_completed ? "text-content-muted line-through" : "text-content-primary"
              )}
            >
              {item.content}
            </span>
            {/* 터치 기기엔 hover가 없으므로 좁은 화면에서는 항상 보인다. */}
            <button
              type="button"
              onClick={() => onRemoveItem(item)}
              className="shrink-0 px-1 text-content-muted transition-opacity hover:text-wither md:opacity-0 md:group-hover:opacity-100"
              aria-label="삭제"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <form
        className="mt-1.5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onAddItem(input);
          setInput("");
        }}
      >
        <PlusIcon size={15} className="shrink-0 text-content-muted" />
        <input
          id={`todo-add-${category.id}`}
          name={`todo-add-${category.id}`}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 200))}
          placeholder="할 일 추가 (예: 수학문제 10번까지 풀기)"
          aria-label={`${category.name}에 할 일 추가`}
          className="min-w-0 flex-1 bg-transparent py-1 text-body-sm text-content-primary outline-none placeholder:text-content-muted"
        />
      </form>
    </Card>
  );
}

// ---------- 분류 편집기 (추가/수정 공용) ----------

interface CategoryEditorProps {
  initialName?: string;
  initialColor?: TodoColor;
  onSave: (name: string, color: TodoColor) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function CategoryEditor({
  initialName = "",
  initialColor = "green",
  onSave,
  onCancel,
  onDelete,
}: CategoryEditorProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<TodoColor>(initialColor);
  // 추가 편집기와 분류별 편집기가 동시에 열릴 수 있어 id가 겹치면 안 된다.
  const fieldId = useId();

  return (
    <div className="mb-3 rounded-lg border border-line-strong bg-black/25 p-3.5">
      <div className="flex items-end gap-2">
        <Field
          id={fieldId}
          name="category-name"
          label="분류 이름"
          className="flex-1"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          placeholder="분류 이름"
        />
        <Button
          size="sm"
          onClick={() => name.trim() && onSave(name.trim(), color)}
          disabled={!name.trim()}
        >
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "h-6 w-6 rounded-full transition-transform hover:scale-110",
              color === c && "ring-2 ring-white/70 ring-offset-2 ring-offset-earth-base"
            )}
            style={{ background: COLOR_HEX[c] }}
            aria-label={c}
            aria-pressed={color === c}
          />
        ))}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto text-caption font-semibold text-wither hover:brightness-125"
          >
            분류 삭제
          </button>
        )}
      </div>
    </div>
  );
}
