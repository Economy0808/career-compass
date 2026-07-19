"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, postChat, postPlant, postPreview } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { ChatMessageIn, ChatRole, RoadmapPreviewOut } from "@/lib/types";

const TYPING_DELAY_MS = 550;

const GREETING =
  "안녕하세요, 씨앗을 심으러 오셨군요.\n이루고 싶은 목표를 편하게 적어주세요. 콩나무가 자랄 길(마일스톤)을 그려드릴게요.";

function Bubble({ role, content }: { role: ChatRole; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`mb-3.5 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[82%] whitespace-pre-line rounded-2xl border px-[17px] py-[13px] text-[13.5px] leading-[1.65] text-[#dcead8]"
        style={{
          background: isUser ? "rgba(63,143,71,.25)" : "rgba(10,26,15,.85)",
          borderColor: isUser ? "rgba(93,179,91,.35)" : "rgba(143,220,138,.14)",
        }}
      >
        {content}
      </div>
    </div>
  );
}

function RootingIndicator({ label }: { label: string }) {
  return (
    <div className="mb-3.5 mt-1 flex items-center gap-1.5 text-[12.5px] text-moss-600">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rounded-full bg-bean-400"
          style={{ animation: `blink 1.2s ${i * 0.2}s infinite` }}
        />
      ))}
      {label}
    </div>
  );
}

function formatDue(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function RoadmapPreviewPanel({ preview }: { preview: RoadmapPreviewOut }) {
  const many = preview.roadmaps.length > 1;
  return (
    <div className="mb-3.5 rounded-2xl border border-[rgba(143,220,138,.2)] bg-[rgba(10,26,15,.9)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-full border border-[rgba(226,192,110,.4)] bg-[rgba(226,192,110,.12)] px-2.5 py-0.5 font-semibold text-[#e2c06e]">
          🎯 대목표 · {preview.career_goal.title}
        </span>
        <span className="text-moss-600">
          {preview.career_goal.is_new
            ? "새 대목표로 만들어요"
            : "기존 대목표 아래에 심어요"}
        </span>
        {many && (
          <span className="text-moss-500">
            🌱 {preview.roadmaps.length}그루의 콩나무를 함께 심어요
          </span>
        )}
      </div>
      <div className="flex flex-col gap-5">
        {preview.roadmaps.map((roadmap, ri) => (
          <div key={ri}>
            <h2 className="mb-2 font-serif text-[18px] font-bold leading-snug text-moss-100">
              {many ? `${ri + 1}. ` : ""}
              {roadmap.title}
            </h2>
            <ol className="flex flex-col gap-2.5">
              {roadmap.milestones.map((m, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-[rgba(143,220,138,.12)] bg-[rgba(255,255,255,.03)] px-3.5 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-semibold text-[#dcead8]">
                      {i + 1}. {m.title}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-moss-600">
                      ~{formatDue(m.due_date)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-moss-400">
                    {m.description}
                  </p>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer select-none text-[11.5px] text-bean-300 hover:text-bean-100">
                      자세한 가이드 보기
                    </summary>
                    <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-moss-300">
                      {m.detail}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-moss-600">
        마음에 들면 아래 버튼으로 씨앗을 심어주세요. 심은 뒤에도 각 마일스톤의 가이드는 언제든 볼 수 있어요.
      </p>
    </div>
  );
}

export default function NewRoadmapPage() {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();

  const [goalRawText, setGoalRawText] = useState("");
  const [messages, setMessages] = useState<ChatMessageIn[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState<RoadmapPreviewOut | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [planting, setPlanting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // 씨앗 심기는 연세대 인증 필수: 미로그인 → 로그인, 미인증 → 인증 페이지로.
  useEffect(() => {
    if (authLoading) return;
    if (!me) router.push("/login");
    else if (!me.yonsei_verified) router.push("/verify");
  }, [authLoading, me, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, done, previewing, preview, planting]);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewFailed(false);
    setError(null);
    try {
      const res = await postPreview(goalRawText, messages);
      setPreview(res);
    } catch (err) {
      setPreviewFailed(true);
      setError(err instanceof ApiError ? err.detail : "로드맵 초안을 그리지 못했어요.");
    } finally {
      setPreviewing(false);
    }
  }, [goalRawText, messages]);

  // 질답이 끝나면 자동으로 로드맵 초안(미리보기)을 그린다.
  useEffect(() => {
    if (done && !preview && !previewing && !previewFailed) void runPreview();
  }, [done, preview, previewing, previewFailed, runPreview]);

  async function send() {
    const text = input.trim();
    if (!text || typing || done || planting || authLoading) return;
    setInput("");
    setError(null);
    setTyping(true);

    // First message plants the goal; later ones answer the AI's questions.
    const isGoal = goalRawText === "";
    const goal = isGoal ? text : goalRawText;
    const nextMessages: ChatMessageIn[] = isGoal
      ? []
      : [...messages, { role: "user", content: text }];
    if (isGoal) setGoalRawText(text);
    else setMessages(nextMessages);

    try {
      const res = await postChat(goal, nextMessages);
      await new Promise((r) => setTimeout(r, TYPING_DELAY_MS));
      setMessages(res.messages);
      setDone(res.done);
    } catch (err) {
      // 서버가 원인을 알려주면(예: AI 연결 장애 503) 그대로 보여준다
      setError(err instanceof ApiError ? err.detail : "답변을 전달하지 못했어요. 다시 시도해주세요.");
      if (isGoal) setGoalRawText("");
    } finally {
      setTyping(false);
    }
  }

  async function plant() {
    if (!me?.yonsei_verified || planting || !preview) return;
    setPlanting(true);
    setError(null);
    try {
      const planted = await postPlant(preview, goalRawText, messages);
      // 한 그루면 바로 그 콩나무로, 여러 그루면 대목표 그룹이 보이는 내 프로필로
      if (planted.length === 1) router.push(`/roadmap/${planted[0].id}`);
      else router.push(`/profile/${me.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "씨앗을 심지 못했어요. 다시 시도해주세요.");
      setPlanting(false);
    }
  }

  const started = goalRawText !== "";

  if (authLoading || !me?.yonsei_verified) {
    return (
      <div className="flex h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)]">
        <p className="animate-pulse text-sm text-moss-600">확인 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)]">
      <div className="mx-auto flex min-h-screen w-[640px] max-w-[86vw] flex-col pt-[88px]">
        <h1 className="font-serif text-[30px] font-bold text-moss-100">새 씨앗 심기</h1>
        <p className="mb-7 mt-[7px] text-[13px] text-moss-600">
          목표를 말해주면 AI가 콩나무가 자랄 길을 그려드려요
        </p>

        <Bubble role="assistant" content={GREETING} />
        {started && <Bubble role="user" content={goalRawText} />}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {typing && <RootingIndicator label="뿌리를 내리는 중…" />}
        {previewing && (
          <RootingIndicator label="지금까지 들은 이야기로 로드맵 초안을 그리는 중… (몇 분 정도 걸릴 수 있어요, 창을 닫지 마세요)" />
        )}
        {planting && <RootingIndicator label="씨앗을 심는 중…" />}
        {preview && <Bubble role="assistant" content={preview.briefing} />}
        {preview && <RoadmapPreviewPanel preview={preview} />}
        {error && <p className="mb-3 text-[12.5px] text-wither-300">{error}</p>}
        <div ref={bottomRef} />

        <div className="sticky bottom-0 mt-auto bg-[linear-gradient(transparent,#06120a_45%)] pb-7 pt-4">
          {preview && !previewing && (
            <button
              type="button"
              onClick={plant}
              disabled={planting}
              className="mb-2.5 w-full rounded-xl border border-bean-400 bg-bean-500 p-3.5 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {planting
                ? "심는 중…"
                : preview.roadmaps.length > 1
                  ? `${preview.roadmaps.length}그루 함께 심기`
                  : "이 로드맵으로 씨앗 심기"}
            </button>
          )}
          {previewFailed && !previewing && (
            <button
              type="button"
              onClick={() => void runPreview()}
              className="mb-2.5 w-full rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] p-3.5 text-sm font-semibold text-bean-100 transition-colors hover:bg-[rgba(143,220,138,.25)]"
            >
              로드맵 다시 그리기
            </button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                started ? "답변을 입력해주세요" : "예: 3학년 여름에 데이터 분석 인턴 하고 싶어"
              }
              disabled={done || planting}
              className="flex-1 rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || typing || done || planting}
              className="rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] px-5 py-3 text-[13px] font-semibold text-bean-100 transition-colors hover:bg-[rgba(143,220,138,.25)] disabled:opacity-50"
            >
              보내기
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
