"use client";

/**
 * 별자리 Intake 대화 오버레이 - 사용자가 목표를 텍스트로 설명하면 서버와
 * 여러 턴에 걸쳐 대화하며 목표를 다듬고, 다듬기가 끝나면(done===true) 그
 * 목표로 구간(bin) 제안 잡을 돌려 결과를 부모에게 넘긴다.
 *
 * 이 컴포넌트는 페이지에 아직 연결되지 않는다(다음 단계에서 배선) - 여기서는
 * 오버레이 자체와 상태 머신만 완성한다.
 *
 * 서버 계약(lib/constellation-api.ts의 IntakeChatResponse 문서 참고): 매 응답의
 * messages 배열은 서버가 이미 갱신한 "전체" 히스토리다. 다음 요청에는 그 배열을
 * 그대로 다시 실어 보내야 한다 - 로컬에서 재구성하면 서버 state와 어긋나
 * 무한 질문 루프에 빠질 수 있다.
 */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";
import {
  getBinJob,
  intakeChat,
  startBinSuggestJob,
  type BinDto,
  type ChatMessageDto,
} from "@/lib/constellation-api";

export interface ConstellationIntakeChatProps {
  /** 구간 생성 잡이 끝나면 호출된다 - 부모가 이 결과로 캔버스를 채운다. */
  onComplete: (bins: BinDto[], goalText: string) => void;
  /** 옵션: 오버레이를 닫는다. 기존 별자리가 있어 새로 만들지 않을 때만 부모가
   * 이 prop을 넘겨 닫기 버튼/Esc를 노출한다. */
  onDismiss?: () => void;
  className?: string;
}

const INTRO_GREETING =
  '안녕하세요! 어떤 진로를 그려보고 싶으신가요?\n예: "AI 개발자가 되고 싶은데 뭘 준비해야 할지 모르겠어요"';

/** 서버도 같은 값으로 히스토리를 자른다(문서 참고) - 프론트도 같은 지점에서
 * 더 이상의 질문을 기다리지 않고 강제로 done 경로로 넘어간다. */
const MAX_MESSAGES = 40;
/** 입력창 글자수 제한 - 서버 쪽 cap과 동일. */
const MAX_INPUT_LENGTH = 2000;
/** 잡 폴링 주기(ms)와 최대 시도 횟수 - 120회 * 1.5초 = 3분. */
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 120;

type Phase = "chat" | "generating";

function detailOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.detail : fallback;
}

export function ConstellationIntakeChat({
  onComplete,
  onDismiss,
  className,
}: ConstellationIntakeChatProps) {
  const [phase, setPhase] = useState<Phase>("chat");

  // --- 채팅 상태 ------------------------------------------------------------
  // messages는 서버가 마지막으로 돌려준 "전체 히스토리"를 그대로 담는다(단,
  // 아직 첫 응답을 받기 전에는 로컬에서 낙관적으로 채운다). 첫 유저 메시지가
  // 곧 goalRawText다 - 이후 요청에서도 그 값을 그대로 재사용한다.
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [goalText, setGoalText] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);

  // --- 구간 생성 잡 상태 ------------------------------------------------------
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobExpired, setJobExpired] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  // 마운트 시 입력창에 포커스.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 메시지가 늘어날 때마다 맨 아래로 스크롤.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  // 언마운트 시 폴링 타이머 정리.
  useEffect(() => {
    return () => stopPolling();
  }, []);

  function startPolling(jobId: string, goal: string) {
    stopPolling();
    pollAttemptsRef.current = 0;
    pollTimerRef.current = setInterval(() => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        stopPolling();
        setJobError("작업이 너무 오래 걸리고 있어요. 다시 시도해 주세요.");
        return;
      }
      getBinJob(jobId)
        .then((status) => {
          if (status.status === "done") {
            stopPolling();
            onComplete(status.result?.bins ?? [], goal);
            return;
          }
          if (status.status === "error") {
            stopPolling();
            setJobError(status.detail ?? "군집을 만드는 중 문제가 생겼어요.");
          }
          // pending/running이면 다음 tick에서 계속 폴링한다.
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            // 서버가 인메모리로 잡을 들고 있어, 서버가 재시작되면 잡이 사라진다.
            stopPolling();
            setJobExpired(true);
            return;
          }
          // 그 외 일시적 오류는 다음 폴링 tick에서 다시 시도한다.
        });
    }, POLL_INTERVAL_MS);
  }

  function startJob(goal: string) {
    setJobError(null);
    setJobExpired(false);
    startBinSuggestJob(goal)
      .then(({ jobId }) => startPolling(jobId, goal))
      .catch((err: unknown) => {
        setJobError(detailOf(err, "구간 생성 요청을 시작하지 못했어요."));
      });
  }

  function beginGenerating(goal: string) {
    setPhase("generating");
    startJob(goal);
  }

  function retryGenerating() {
    if (!goalText) return;
    beginGenerating(goalText);
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || pending || messages.length >= MAX_MESSAGES) return;

    setChatError(null);
    setLastFailedText(null);

    const isFirstTurn = goalText === null;
    const goal = isFirstTurn ? text : goalText;
    const userMsg: ChatMessageDto = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];

    if (isFirstTurn) setGoalText(goal);
    setMessages(nextMessages);
    setDraft("");
    setPending(true);

    try {
      const res = await intakeChat({ goalRawText: goal, messages: nextMessages });
      setMessages(res.messages);
      setPending(false);
      if (res.done || res.messages.length >= MAX_MESSAGES) {
        beginGenerating(goal);
      }
    } catch (err) {
      // 실패 시 낙관적으로 붙였던 메시지를 되돌리고, 입력했던 텍스트는
      // 잃어버리지 않도록 입력창에 복원한다 - "다시 보내기"로 재전송 가능.
      setPending(false);
      setMessages(messages);
      if (isFirstTurn) setGoalText(null);
      setDraft(text);
      setLastFailedText(text);
      setChatError(detailOf(err, "메시지를 보내지 못했어요. 다시 시도해 주세요."));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(draft);
  }

  function handleResend() {
    if (lastFailedText) void sendMessage(lastFailedText);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && onDismiss) {
      e.stopPropagation();
      onDismiss();
    }
  }

  const inputDisabled = pending || messages.length >= MAX_MESSAGES;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="별자리 목표 대화"
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-rule bg-ink-800/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
          <h2 className="font-serif text-base font-bold text-text-hi">
            {phase === "chat" ? "목표 이야기하기" : "별자리 만드는 중"}
          </h2>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="닫기"
              className="ml-auto rounded-sm px-1.5 py-1 text-text-lo transition-colors hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            >
              ✕
            </button>
          )}
        </div>

        {phase === "chat" ? (
          <>
            <div
              role="log"
              aria-live="polite"
              className="canvas-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5"
            >
              <ChatBubble role="assistant">{INTRO_GREETING}</ChatBubble>
              {messages.map((m, idx) => (
                <ChatBubble key={idx} role={m.role}>
                  {m.content}
                </ChatBubble>
              ))}
              {pending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="border-t border-rule px-4 py-3">
              {chatError && (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-spec-m/45 bg-spec-m/10 px-3 py-2 font-sans text-xs text-spec-m">
                  <span className="flex-1">{chatError}</span>
                  {lastFailedText && (
                    <button
                      type="button"
                      onClick={handleResend}
                      className="shrink-0 underline decoration-dotted underline-offset-2 hover:text-text-hi"
                    >
                      다시 보내기
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_INPUT_LENGTH}
                  disabled={inputDisabled}
                  placeholder="여기에 입력해 주세요..."
                  aria-label="메시지 입력"
                  className="min-w-0 flex-1 rounded-md border border-rule bg-ink-900/70 px-3 py-2 font-sans text-sm text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b disabled:opacity-50"
                />
                <Button type="submit" size="md" disabled={inputDisabled || !draft.trim()}>
                  보내기
                </Button>
              </div>
            </form>
          </>
        ) : (
          <GeneratingPanel error={jobError} expired={jobExpired} onRetry={retryGenerating} />
        )}
      </div>
    </div>
  );
}

function ChatBubble({ role, children }: { role: "user" | "assistant"; children: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2 font-sans text-sm leading-relaxed",
          isUser ? "bg-spec-b/16 text-text-hi" : "bg-ink-700 text-text-hi"
        )}
      >
        {children}
      </p>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg bg-ink-700 px-3.5 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-text-lo motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
        <span className="sr-only">입력 중…</span>
      </div>
    </div>
  );
}

function GeneratingPanel({
  error,
  expired,
  onRetry,
}: {
  error: string | null;
  expired: boolean;
  onRetry: () => void;
}) {
  if (expired) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="font-sans text-sm text-text-hi">작업이 만료됐어요. 다시 시도해 주세요.</p>
        <Button onClick={onRetry}>다시 시도</Button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="font-sans text-sm text-spec-m">{error}</p>
        <Button onClick={onRetry}>다시 시도</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex items-center gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-spec-b motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
      <p className="font-sans text-sm text-text-hi" role="status" aria-live="polite">
        군집을 만드는 중…
      </p>
      <p className="font-sans text-xs text-text-lo">잠시만 기다려 주세요. 시간이 조금 걸릴 수 있어요.</p>
    </div>
  );
}
