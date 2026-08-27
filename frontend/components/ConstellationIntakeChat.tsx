"use client";

/**
 * 별자리 Intake 대화 오버레이 - 사용자가 목표를 텍스트로 설명하면 서버와
 * 여러 턴에 걸쳐 대화하며 목표를 다듬고, 다듬기가 끝나면(done===true) 그
 * 목표로 구간(bin) 제안 잡을 돌려 결과를 부모에게 넘긴다.
 *
 * 시각 디자인은 승인된 시안 보드 3("대화") - 전체 화면을 덮는 어두운 관측
 * 화면에, 지나간 질문/답은 흐리게, 지금 답할 질문만 또렷하게 보여준다.
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
import { ApiError } from "@/lib/api";
import {
  getBinJob,
  intakeChat,
  startBinSuggestJob,
  type BinDto,
  type ChatMessageDto,
  type DraftDto,
} from "@/lib/constellation-api";

export interface ConstellationIntakeChatProps {
  /** 구간 생성 잡이 끝나면 호출된다 - 부모가 이 결과로 캔버스를 채운다.
   * drafts는 있을 수도(0~3개) 없을 수도 있다 - 없으면 부모는 기존처럼 빈
   * 캔버스에 보관함만 채운다. */
  onComplete: (bins: BinDto[], goalText: string, drafts?: DraftDto[]) => void;
  /** 옵션: 오버레이를 닫는다. 기존 별자리가 있어 새로 만들지 않을 때만 부모가
   * 이 prop을 넘겨 닫기 링크를 노출한다. */
  onDismiss?: () => void;
  /** 옵션: 이미 저장된 별자리가 있을 때만 부모가 채워 준다("별자리가
   * 이미 있어요"). 우상단에 작은 배지로 떠서 onDismiss로 바로 빠져나갈 수
   * 있게 한다 - onDismiss가 없으면(빠져나갈 곳이 없으면) 값이 있어도 렌더링하지 않는다. */
  existingNotice?: string;
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
/** 진행 표시가 채울 총 질문 칸 수(시안 보드 3: "Q n / 6"). */
const TOTAL_QUESTION_SLOTS = 6;

type Phase = "chat" | "generating";

/** 질문 하나 + (있다면) 그에 대한 답. 인트로 문구도 첫 "질문"으로 취급한다. */
interface Turn {
  question: string;
  answer?: string;
}

function detailOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.detail : fallback;
}

/** messages(서버가 돌려준 전체 히스토리)를 질문/답 쌍으로 엮는다.
 * user 메시지는 직전 질문의 답으로, assistant 메시지는 새 질문으로 취급한다. */
function buildTurns(messages: ChatMessageDto[]): Turn[] {
  const turns: Turn[] = [{ question: INTRO_GREETING }];
  for (const m of messages) {
    if (m.role === "user") {
      turns[turns.length - 1].answer = m.content;
    } else {
      turns.push({ question: m.content });
    }
  }
  return turns;
}

export function ConstellationIntakeChat({
  onComplete,
  onDismiss,
  existingNotice,
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
  // 지금 질문에 딸린 입력 보조 힌트/칩 - 서버 응답 밖(messages와 별개)이라 따로 든다.
  const [hint, setHint] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);

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
            onComplete(status.result?.bins ?? [], goal, status.result?.drafts);
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
    // 다음 질문이 올 때까지는 지금 칩/힌트를 지운다 - 이전 질문 것이 남아있으면
    // 아직 답 안 한 다음 질문에 엉뚱한 칩이 붙어 보인다.
    setHint(null);
    setOptions([]);

    try {
      const res = await intakeChat({ goalRawText: goal, messages: nextMessages });
      setMessages(res.messages);
      // 구버전 서버(hint/options 미지원)와도 안전하게 - 신뢰 경계에서 기본값 방어.
      setHint(res.done ? null : (res.hint ?? null));
      setOptions(res.done ? [] : (res.options ?? []));
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

  // 질문/답 쌍으로 재구성 - 마지막 턴에 아직 답이 없으면 그게 "지금" 질문,
  // 있으면(=답변 전송 후 서버 응답 대기 중) 지금 칸엔 타이핑 표시가 대신 뜬다.
  const turns = buildTurns(messages);
  const lastTurn = turns[turns.length - 1];
  const openTurn = lastTurn.answer === undefined ? lastTurn : null;
  const pastTurns = openTurn ? turns.slice(0, -1) : turns;
  const qDisplay = Math.min(turns.length, TOTAL_QUESTION_SLOTS);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="별자리 목표 대화"
      onKeyDown={handleKeyDown}
      className={cn("fixed inset-0 z-30 overflow-hidden bg-ink-900", className)}
    >
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
      <BackgroundStars />

      {/* 우상단 "기존 별자리가 있어요" 배지 - 빠져나갈 곳(onDismiss)이 있을
          때만 뜬다. 대화는 그대로 진행 중일 수 있으므로 대화 UI 위(z-20)에
          겹쳐도 방해되지 않게 작고 조용하게 둔다. */}
      {existingNotice && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="fixed right-6 top-6 z-20 rounded-full border border-rule bg-ink-800/90 px-3.5 py-2 font-sans text-caption text-text-lo transition-colors hover:text-text-hi"
        >
          {existingNotice} · 이어서 편집
        </button>
      )}

      <ProgressHeader current={qDisplay} total={TOTAL_QUESTION_SLOTS} />

      {phase === "chat" ? (
        <>
          <div
            role="log"
            aria-live="polite"
            className="canvas-scroll fixed left-1/2 top-[150px] bottom-[150px] w-[min(720px,92vw)] -translate-x-1/2 overflow-y-auto"
          >
            <div className="flex flex-col gap-[34px] pb-2">
              {pastTurns.map((t, idx) => (
                <div key={idx} className="flex flex-col gap-3 opacity-[0.45]">
                  <div className="flex items-start gap-3">
                    <StarGlyph size={16} className="mt-1 shrink-0" />
                    <p className="whitespace-pre-wrap text-base leading-[1.7] text-text-hi">
                      {t.question}
                    </p>
                  </div>
                  {t.answer && (
                    <p className="max-w-[480px] self-end whitespace-pre-wrap rounded-md border border-rule bg-ink-800 px-[18px] py-3 text-[15px] leading-[1.65] text-text-hi">
                      {t.answer}
                    </p>
                  )}
                </div>
              ))}

              {openTurn ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <StarGlyph size={18} className="mt-1 shrink-0" />
                    <p className="whitespace-pre-wrap font-serif text-[22px] leading-[1.65] text-text-hi">
                      {openTurn.question}
                    </p>
                  </div>
                  {(hint || options.length > 0) && (
                    <div className="flex flex-col gap-2.5 pl-[30px]">
                      {hint && (
                        <p className="whitespace-pre-wrap text-[13.5px] text-text-lo">{hint}</p>
                      )}
                      {options.length > 0 && (
                        <div className="flex flex-wrap gap-2.5">
                          {options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              disabled={inputDisabled}
                              onClick={() => void sendMessage(opt)}
                              className="rounded-full border border-rule px-4 py-2 text-[13.5px] text-text-lo transition-colors hover:border-text-hi/30 hover:text-text-hi disabled:pointer-events-none disabled:opacity-50"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <TypingDots />
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="fixed inset-x-0 bottom-[72px] z-10 flex justify-center px-4">
            <div className="w-[min(720px,92vw)]">
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
              <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_INPUT_LENGTH}
                  disabled={inputDisabled}
                  placeholder="답을 입력하세요…"
                  aria-label="메시지 입력"
                  className="min-w-0 flex-1 rounded-full border border-rule bg-ink-800 px-[22px] py-[15px] font-sans text-[15px] text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={inputDisabled || !draft.trim()}
                  aria-label="보내기"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-rule bg-ink-700 text-text-hi transition-colors hover:border-lit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b disabled:opacity-50 disabled:pointer-events-none"
                >
                  <ArrowUpIcon />
                </button>
              </form>
            </div>
          </div>
        </>
      ) : (
        <GeneratingStage error={jobError} expired={jobExpired} onRetry={retryGenerating} />
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="fixed bottom-[52px] left-[60px] z-10 font-sans text-xs text-text-lo transition-colors hover:text-text-hi"
        >
          저장하고 그만두기
        </button>
      )}
    </div>
  );
}

/** 8-point 별빛 글리프 - 관측 기록 톤의 질문 표식. */
function StarGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--lit)"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M8 1.5 L8 14.5 M1.5 8 L14.5 8 M3.7 3.7 L12.3 12.3 M12.3 3.7 L3.7 12.3" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/** 화면 곳곳에 흩뿌린 희미한 별 8개 - 순전히 장식. */
const BACKGROUND_STARS = [
  { x: 8, y: 12, r: 1.4, o: 0.4 },
  { x: 22, y: 68, r: 1, o: 0.32 },
  { x: 40, y: 22, r: 1.6, o: 0.5 },
  { x: 63, y: 14, r: 1, o: 0.35 },
  { x: 78, y: 55, r: 1.3, o: 0.45 },
  { x: 90, y: 30, r: 1, o: 0.3 },
  { x: 15, y: 85, r: 1.5, o: 0.55 },
  { x: 55, y: 90, r: 1, o: 0.38 },
];

function BackgroundStars() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {BACKGROUND_STARS.map((s, idx) => (
        <circle key={idx} cx={s.x} cy={s.y} r={s.r} fill="var(--text-hi)" opacity={s.o} />
      ))}
    </svg>
  );
}

/** 상단 중앙 "Q n / 6" + 진행 점 6개. chat/generating 두 단계 모두에서 보인다. */
function ProgressHeader({ current, total }: { current: number; total: number }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex flex-col items-center gap-[10px] pt-10">
      <span className="font-mono text-xs tracking-[0.12em] text-text-lo">
        Q {current} / {total}
      </span>
      <div className="flex items-center gap-3">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              n === current
                ? "bg-lit shadow-[0_0_10px_rgba(255,243,196,0.6)]"
                : n < current
                  ? "bg-lit"
                  : "border border-rule bg-transparent"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** 다음 질문을 기다리는 동안 지금 질문 자리에 대신 뜨는 펄스 점 3개. */
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1" role="status" aria-label="다음 질문을 준비하는 중">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-lit motion-safe:animate-pulse"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function GeneratingStage({
  error,
  expired,
  onRetry,
}: {
  error: string | null;
  expired: boolean;
  onRetry: () => void;
}) {
  if (expired || error) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-sans text-sm text-spec-m">
          {expired ? "작업이 만료됐어요. 다시 시도해 주세요." : error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-rule px-5 py-2.5 font-sans text-sm text-text-hi transition-colors hover:border-lit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b"
        >
          다시 시도
        </button>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-serif text-xl text-text-hi" role="status" aria-live="polite">
        별자리 초안을 그리는 중…
      </p>
      <TypingDots />
    </div>
  );
}
