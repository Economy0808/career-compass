"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postChat, postGenerate } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { ChatMessageIn, ChatRole } from "@/lib/types";

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

function RootingIndicator() {
  return (
    <div className="mb-3.5 mt-1 flex items-center gap-1.5 text-[12.5px] text-moss-600">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rounded-full bg-bean-400"
          style={{ animation: `blink 1.2s ${i * 0.2}s infinite` }}
        />
      ))}
      뿌리를 내리는 중…
    </div>
  );
}

export default function NewRoadmapPage() {
  const router = useRouter();
  const { currentUser, loading: userLoading } = useUser();

  const [goalRawText, setGoalRawText] = useState("");
  const [messages, setMessages] = useState<ChatMessageIn[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(false);
  const [planting, setPlanting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, done, planting]);

  async function send() {
    const text = input.trim();
    if (!text || typing || done || planting || userLoading) return;
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
    } catch {
      setError("답변을 전달하지 못했어요. 다시 시도해주세요.");
      if (isGoal) setGoalRawText("");
    } finally {
      setTyping(false);
    }
  }

  async function plant() {
    if (!currentUser || planting) return;
    setPlanting(true);
    setError(null);
    try {
      const roadmap = await postGenerate(currentUser.id, goalRawText, messages);
      router.push(`/roadmap/${roadmap.id}`);
    } catch {
      setError("씨앗을 심지 못했어요. 다시 시도해주세요.");
      setPlanting(false);
    }
  }

  const started = goalRawText !== "";

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
        {(typing || planting) && <RootingIndicator />}
        {done && !planting && (
          <Bubble
            role="assistant"
            content="질문에 모두 답해주셨어요. 마음에 들면 아래에서 씨앗을 심어주세요."
          />
        )}
        {error && <p className="mb-3 text-[12.5px] text-wither-300">{error}</p>}
        <div ref={bottomRef} />

        <div className="sticky bottom-0 mt-auto bg-[linear-gradient(transparent,#06120a_45%)] pb-7 pt-4">
          {done && (
            <button
              type="button"
              onClick={plant}
              disabled={planting || !currentUser}
              className="mb-2.5 w-full rounded-xl border border-bean-400 bg-bean-500 p-3.5 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {planting ? "심는 중…" : "이 로드맵 심기"}
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
