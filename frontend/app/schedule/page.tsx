"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BeanCheckbox } from "@/components/BeanCheckbox";
import { DayCompleteCelebration } from "@/components/DayCompleteCelebration";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
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
import { celebrateCheck } from "@/lib/feedback";
import { todayISODate } from "@/lib/format";
import type { CalendarDayOut, TodoCategoryOut, TodoColor, TodoItemOut } from "@/lib/types";

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
    const nextItems = items.map((i) =>
      i.id === item.id ? { ...i, is_completed: next } : i
    );
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
      <div className="flex h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
        <p className="animate-pulse text-sm text-moss-600">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_60%)]">
      <div className="ml-[230px] mr-10 max-w-[760px] pb-[90px] pt-[88px]">
        <h1 className="font-serif text-[30px] font-bold text-moss-100">일정</h1>
        <p className="mt-[7px] text-[13px] text-moss-600">
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

        <div className="mb-3 mt-8 flex items-center">
          <h2 className="font-serif text-[18px] font-bold text-moss-100">
            {selectedDate.replace(/-/g, ".")}
          </h2>
          {!addingCategory && (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
              className="ml-auto rounded-full border border-[rgba(143,220,138,.25)] px-3.5 py-1.5 text-[12px] font-semibold text-moss-400 transition-colors hover:bg-[rgba(143,220,138,.12)] hover:text-moss-200"
            >
              + 분류 추가
            </button>
          )}
        </div>

        {addingCategory && (
          <CategoryEditor
            onSave={addCategory}
            onCancel={() => setAddingCategory(false)}
          />
        )}

        {loading ? (
          <div className="mt-3 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl border border-[rgba(143,220,138,.1)] bg-[rgba(14,33,20,.35)]"
              />
            ))}
          </div>
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
      </div>

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
    <div className="rounded-2xl border border-[rgba(143,220,138,.13)] bg-[linear-gradient(180deg,rgba(14,33,20,.5),rgba(8,20,12,.8))] p-4">
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
          <span className="h-3 w-3 rounded-full" style={{ background: hex }} />
          <span className="text-[14px] font-bold text-moss-100">{category.name}</span>
          <span className="text-[11px] text-moss-700">
            {items.filter((i) => i.is_completed).length}/{items.length}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto text-[11.5px] text-moss-600 transition-colors hover:text-moss-300"
          >
            편집
          </button>
        </div>
      )}

      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2.5 py-1.5">
            <BeanCheckbox checked={item.is_completed} onToggle={() => onToggleItem(item)} />
            <span
              className={`flex-1 text-[13.5px] ${
                item.is_completed ? "text-moss-700 line-through" : "text-moss-200"
              }`}
            >
              {item.content}
            </span>
            <button
              type="button"
              onClick={() => onRemoveItem(item)}
              className="shrink-0 px-1 text-[13px] text-moss-800 opacity-0 transition-opacity hover:text-wither-300 group-hover:opacity-100"
              aria-label="삭제"
            >
              ✕
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
        <span className="text-[15px] text-moss-700">+</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 200))}
          placeholder="할 일 추가 (예: 수학문제 10번까지 풀기)"
          className="flex-1 bg-transparent py-1 text-[13px] text-moss-100 outline-none placeholder:text-moss-700"
        />
      </form>
    </div>
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

  return (
    <div className="mb-3 rounded-2xl border border-[rgba(143,220,138,.2)] bg-[rgba(6,18,10,.6)] p-3.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          placeholder="분류 이름"
          className="flex-1 rounded-lg border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-[13px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]"
        />
        <button
          type="button"
          onClick={() => name.trim() && onSave(name.trim(), color)}
          disabled={!name.trim()}
          className="rounded-lg border border-bean-400 bg-bean-500 px-3.5 py-2 text-[12.5px] font-bold text-[#f0f7ec] transition-colors hover:bg-[#4aa353] disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-2 text-[12.5px] text-moss-500 hover:text-moss-300"
        >
          취소
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              color === c ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[#0a1f11]" : ""
            }`}
            style={{ background: COLOR_HEX[c] }}
            aria-label={c}
          />
        ))}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto text-[11.5px] font-semibold text-wither-300 hover:brightness-125"
          >
            분류 삭제
          </button>
        )}
      </div>
    </div>
  );
}
