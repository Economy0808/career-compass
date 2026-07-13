"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ChatBubble, TypingIndicator } from "@/components/ChatBubble";
import { Button } from "@/components/Button";
import { postChat, postGenerate } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { ChatMessageIn } from "@/lib/types";

type Phase = "goal-input" | "chatting" | "done" | "generating";

const TYPING_DELAY_MS = 550;

export default function NewRoadmapPage() {
  const router = useRouter();
  const { currentUser, loading: userLoading } = useUser();

  const [phase, setPhase] = useState<Phase>("goal-input");
  const [goalInput, setGoalInput] = useState("");
  const [goalRawText, setGoalRawText] = useState("");
  const [messages, setMessages] = useState<ChatMessageIn[]>([]);
  const [answerInput, setAnswerInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, phase]);

  async function startChat(e: React.FormEvent) {
    e.preventDefault();
    const goal = goalInput.trim();
    if (!goal) return;
    setGoalRawText(goal);
    setPhase("chatting");
    setTyping(true);
    setError(null);
    try {
      const res = await postChat(goal, []);
      await new Promise((r) => setTimeout(r, TYPING_DELAY_MS));
      setMessages(res.messages);
      setPhase(res.done ? "done" : "chatting");
    } catch {
      setError("질문을 불러오지 못했어요. 다시 시도해주세요.");
      setPhase("goal-input");
    } finally {
      setTyping(false);
    }
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    const answer = answerInput.trim();
    if (!answer) return;
    const nextMessages: ChatMessageIn[] = [...messages, { role: "user", content: answer }];
    setMessages(nextMessages);
    setAnswerInput("");
    setTyping(true);
    setError(null);
    try {
      const res = await postChat(goalRawText, nextMessages);
      await new Promise((r) => setTimeout(r, TYPING_DELAY_MS));
      setMessages(res.messages);
      setPhase(res.done ? "done" : "chatting");
    } catch {
      setError("답변을 전달하지 못했어요. 다시 시도해주세요.");
    } finally {
      setTyping(false);
    }
  }

  async function generateRoadmap() {
    if (!currentUser) return;
    setPhase("generating");
    setError(null);
    try {
      const roadmap = await postGenerate(currentUser.id, goalRawText, messages);
      router.push(`/roadmap/${roadmap.id}`);
    } catch {
      setError("로드맵 생성에 실패했어요. 다시 시도해주세요.");
      setPhase("done");
    }
  }

  const awaitingAnswer =
    phase === "chatting" && !typing && messages.at(-1)?.role === "assistant";

  if (phase === "goal-input") {
    return (
      <div className="flex flex-col gap-6 pt-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">어떤 목표를 갖고 있나요?</h1>
          <p className="text-sm text-muted">
            편하게 적어주세요. 몇 가지 질문을 거쳐 나만의 로드맵을 함께 만들어볼게요.
          </p>
        </div>
        <form onSubmit={startChat} className="space-y-3">
          <textarea
            autoFocus
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="예) 데이터 분석가가 되고 싶어"
            rows={4}
            className="w-full resize-none rounded-3xl border border-border bg-surface p-4 text-sm shadow-soft outline-none focus:ring-2 focus:ring-accent-400"
          />
          {error && <p className="text-sm text-overdue-600">{error}</p>}
          <Button type="submit" disabled={!goalInput.trim() || userLoading}>
            시작하기
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-3 pb-28">
        <ChatBubble role="user" content={goalRawText} />
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        <AnimatePresence>{typing && <TypingIndicator />}</AnimatePresence>

        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-surface p-6 text-center shadow-soft"
          >
            <p className="text-sm text-muted">질문에 모두 답해주셨어요. 로드맵을 만들어볼까요?</p>
            <Button onClick={generateRoadmap}>로드맵 만들기</Button>
          </motion.div>
        )}

        {phase === "generating" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 py-10 text-center"
          >
            <motion.span
              className="text-3xl"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            >
              🧭
            </motion.span>
            <p className="text-sm text-muted">로드맵을 만들고 있어요...</p>
          </motion.div>
        )}

        {error && <p className="text-sm text-overdue-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {awaitingAnswer && (
        <form
          onSubmit={submitAnswer}
          className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
            <input
              autoFocus
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              placeholder="답변을 입력해주세요"
              className="flex-1 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent-400"
            />
            <Button type="submit" disabled={!answerInput.trim()}>
              전송
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
