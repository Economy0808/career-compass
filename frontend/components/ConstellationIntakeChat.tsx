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
import { GeneratingGuide } from "@/components/GeneratingGuide";
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

/** 서버가 준 칩 목록 뒤에 항상 덧붙이는 "직접 입력" 칩 - 서버 계약(options)에는
 * 없는, 프론트 전용 UX 보조 칩이다. 이 라벨 자체는 메시지에 포함되지 않는다. */
const OTHER_CHIP_LABEL = "기타(직접 입력)";

/** 서버도 같은 값으로 히스토리를 자른다(문서 참고) - 프론트도 같은 지점에서
 * 더 이상의 질문을 기다리지 않고 강제로 done 경로로 넘어간다. */
const MAX_MESSAGES = 40;
/** 입력창 글자수 제한 - 서버 쪽 cap과 동일. */
const MAX_INPUT_LENGTH = 2000;
/** 잡 폴링 주기(ms)와 최대 시도 횟수 - 400회 * 1.5초 = 10분. 실 LLM 전환 후
 * 초안 생성이 5분을 넘기도 해서(사용자 실측) 구 상한 3분은 완료 전에 만료
 * 화면을 띄웠다. 서버 잡 TTL보다는 짧게 유지. */
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 400;
/** 진행 표시가 채울 총 질문 칸 수(시안 보드 3: "Q n / 6"). */
const TOTAL_QUESTION_SLOTS = 6;

// ---- 대화 진행분 임시 보관(뒤로가기 방어) ----------------------------------
// 탭 단위 보관이라 탭을 닫으면 사라진다. 서버로 보내지 않는다.
const DRAFT_CHAT_KEY = "ourlab-intake-draft";

interface DraftChat {
  messages: ChatMessageDto[];
  goalText: string | null;
}

/** 보관분 복원 - 프라이빗 모드·저장소 차단이면 접근 자체가 throw 하므로
 * 전부 감싼다. 형식이 깨졌으면 조용히 버리고 빈 대화로 시작한다. */
function loadDraftChat(): DraftChat {
  try {
    const raw = sessionStorage.getItem(DRAFT_CHAT_KEY);
    if (!raw) return { messages: [], goalText: null };
    const parsed = JSON.parse(raw) as Partial<DraftChat>;
    if (!Array.isArray(parsed.messages)) return { messages: [], goalText: null };
    return {
      messages: parsed.messages,
      goalText: typeof parsed.goalText === "string" ? parsed.goalText : null,
    };
  } catch {
    return { messages: [], goalText: null };
  }
}

function saveDraftChat(draft: DraftChat): void {
  try {
    sessionStorage.setItem(DRAFT_CHAT_KEY, JSON.stringify(draft));
  } catch {
    // 용량 초과·차단 - 보존은 부가 기능이라 조용히 포기한다.
  }
}

/** 대화가 끝났거나(완료) 사용자가 빠져나간(이탈) 시점에 비운다. 안 비우면
 * "새 별자리 만들기"로 새 대화를 열었을 때 옛 대화가 되살아난다.
 *
 * export인 이유: "새 별자리 만들기"는 **부모(page.tsx) 쪽 경로**라 이 컴포넌트의
 * onComplete·onDismiss를 거치지 않는다. 실제로 그 경로에서 옛 대화가 되살아나는
 * 버그가 났고(라이브 실측), 키를 두 곳에 복제하지 않으려고 함수를 공개한다. */
export function clearDraftChat(): void {
  try {
    sessionStorage.removeItem(DRAFT_CHAT_KEY);
  } catch {
    // 무시 - 다음 로드에서 형식 검사가 걸러 준다.
  }
}

type Phase = "chat" | "generating";

/** 질문 하나 + (있다면) 그에 대한 답. 인트로 문구도 첫 "질문"으로 취급한다. */
interface Turn {
  question: string;
  answer?: string;
  /** answer가 messages 배열의 몇 번째 항목인지 - 답 번복(revise)이 이 지점
   * 직전까지 히스토리를 자르는 데 쓴다. answer 없으면 의미 없음. */
  answerIndex?: number;
}

function detailOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.detail : fallback;
}

/** messages(서버가 돌려준 전체 히스토리)를 질문/답 쌍으로 엮는다.
 * user 메시지는 직전 질문의 답으로, assistant 메시지는 새 질문으로 취급한다. */
function buildTurns(messages: ChatMessageDto[]): Turn[] {
  const turns: Turn[] = [{ question: INTRO_GREETING }];
  messages.forEach((m, i) => {
    if (m.role === "user") {
      turns[turns.length - 1].answer = m.content;
      turns[turns.length - 1].answerIndex = i;
    } else {
      turns.push({ question: m.content });
    }
  });
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
  // 뒤로가기 한 번에 대화가 통째로 날아가던 문제(베타 테스트 다수 보고) -
  // 이 컴포넌트가 언마운트되면 메모리 상태가 사라지기 때문이었다. 진행분을
  // sessionStorage에 얹어 뒤로/앞으로 가도 이어지게 한다.
  //
  // 왜 sessionStorage인가(사용자 질문: "쿠키나 캐시나 그런걸로 해결 못하나"):
  // **탭 단위로 살고 탭을 닫으면 사라진다** - 공용 데모 계정에서 다음 사람이
  // 남의 대화를 물려받지 않는다. 쿠키는 매 요청에 실려 가 낭비고, localStorage는
  // 영구라 지우는 시점을 계속 관리해야 해서 오히려 지저분해진다.
  const [messages, setMessages] = useState<ChatMessageDto[]>(() => loadDraftChat().messages);
  const [goalText, setGoalText] = useState<string | null>(() => loadDraftChat().goalText);
  // 진행분이 바뀔 때마다 보관해 둔다(뒤로가기 대비). 빈 대화는 저장하지 않아
  // 새로 연 대화가 옛 보관분을 덮어쓰기만 하고 끝나는 일이 없게 한다.
  useEffect(() => {
    if (messages.length === 0 && goalText === null) return;
    saveDraftChat({ messages, goalText });
  }, [messages, goalText]);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  // 첫 메시지 = 무료권 차감 시점(2026-09-03 사용자 확정: "첫대화 엔터 누르면
  // 그때 무료사용권 차감 경고창"). 첫 전송 직전에 이 텍스트를 보관해 확인 모달을
  // 띄우고, "계속"을 눌러야 실제로 보낸다(백엔드가 첫 /chat에서 1회 차감).
  const [chargeGateText, setChargeGateText] = useState<string | null>(null);
  // 지금 질문에 딸린 입력 보조 힌트/칩 - 서버 응답 밖(messages와 별개)이라 따로 든다.
  const [hint, setHint] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  // 지금 질문의 칩 중 사용자가 골라둔 것들(복수 선택) - "선택 완료" 전송 전까지는
  // 로컬 상태로만 들고 있다가, 전송 시 ", "로 이어 하나의 메시지로 보낸다.
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  // "기타(직접 입력)" 칩 선택 여부 - 이 칩 자체는 메시지에 실리지 않고, 텍스트
  // 입력에 포커스 + placeholder 안내만 트리거한다.
  const [otherSelected, setOtherSelected] = useState(false);

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

  // 메시지가 늘어날 때마다(+ 새 칩/힌트가 뜨거나 칩 선택으로 내용 높이가
  // 바뀔 때마다) 맨 아래로 스크롤 - 칩이 여러 줄로 wrap돼도 방금 뜬 내용이
  // 스크롤 영역 밖에 묻히지 않게 한다.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, hint, options, selectedOptions, otherSelected]);

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
            // 대화가 결과로 넘어갔으니 보관분을 비운다 - 안 비우면 다음에
            // "새 별자리 만들기"로 연 대화에 옛 내용이 되살아난다.
            clearDraftChat();
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

  /** 과거 답 번복 - 그 답 "직전"까지 히스토리를 자르고 입력창에 옛 답을
   * 프리필한다. 챗은 stateless(프론트가 messages 전체를 매번 재전송)라
   * 서버 변경 없이 배열만 자르면 대화가 그 지점부터 다시 이어진다. */
  function reviseAnswer(answerIndex: number) {
    if (pending) return; // 전송 중 번복 금지(버튼도 비활성이지만 이중 방어)
    const old = messages[answerIndex];
    if (!old || old.role !== "user") return;

    setMessages(messages.slice(0, answerIndex));
    if (answerIndex === 0) {
      // 첫 답 = goalRawText 자체다. 안 지우면 새 답을 보내도 옛 목표로
      // 군집이 생성된다. 그리고 빈 대화는 저장 effect가 건너뛰므로(덮어쓰기
      // 방지 가드) sessionStorage의 옛 초안을 여기서 직접 지운다 - 안 그러면
      // 뒤로가기 복원이 번복 전 상태로 돌아간다.
      setGoalText(null);
      clearDraftChat();
    }
    // 현재 질문의 칩/힌트는 번복 전 질문 것이다 - 비워 두면 재전송 응답이
    // 새 질문 것으로 다시 채운다.
    setHint(null);
    setOptions([]);
    setSelectedOptions([]);
    setOtherSelected(false);
    setChatError(null);
    setLastFailedText(null);
    setDraft(old.content);
  }

  async function sendMessage(rawText: string, opts: { confirmed?: boolean } = {}) {
    const text = rawText.trim();
    if (!text || pending || messages.length >= MAX_MESSAGES) return;

    // 첫 메시지는 무료권 차감 시점이라 확인 모달을 먼저 거친다. "계속"을 누르면
    // confirmed로 재호출돼 이 게이트를 통과한다. 취소하면 텍스트는 draft에
    // 그대로 남아 다시 시도할 수 있다.
    if (goalText === null && !opts.confirmed) {
      setChargeGateText(text);
      return;
    }

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
    setSelectedOptions([]);
    setOtherSelected(false);

    try {
      const res = await intakeChat({ goalRawText: goal, messages: nextMessages });
      setMessages(res.messages);
      // 구버전 서버(hint/options 미지원)와도 안전하게 - 신뢰 경계에서 기본값 방어.
      setHint(res.done ? null : (res.hint ?? null));
      setOptions(res.done ? [] : (res.options ?? []));
      setSelectedOptions([]);
      setOtherSelected(false);
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

  /** 선택된 일반 칩들 + (있다면) 텍스트 입력 내용을 ", "로 이어 한 메시지로
   * 합친다. "기타" 칩 자체의 라벨은 포함하지 않는다 - 타이핑한 내용만 실린다.
   * 칩 완료 버튼과 입력창 전송 버튼이 이 함수 하나로 같은 조합 규칙을 탄다. */
  function composeMessage(): string {
    const parts = [...selectedOptions];
    const typed = draft.trim();
    if (typed) parts.push(typed);
    return parts.join(", ");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(composeMessage());
  }

  function toggleOption(opt: string) {
    setSelectedOptions((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  }

  function toggleOther() {
    setOtherSelected((prev) => {
      const next = !prev;
      if (next) inputRef.current?.focus();
      return next;
    });
  }

  function handleResend() {
    if (lastFailedText) void sendMessage(lastFailedText);
  }

  /** 이탈 경로(Escape·"이어서 편집" 배지)를 한 곳으로 모은다 - 나가는 건
   * 대화를 접겠다는 뜻이므로 보관분도 함께 비운다. 두 호출부가 각자 비우면
   * 한쪽을 빠뜨린다. */
  function handleDismiss() {
    clearDraftChat();
    onDismiss?.();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && onDismiss) {
      e.stopPropagation();
      handleDismiss();
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
      className={cn("fixed inset-0 z-40 overflow-hidden bg-ink-900", className)}
    >
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
      <BackgroundStars />

      {/* 첫 메시지 차감 확인 - 무료권/크레딧 1개가 이 대화에 쓰인다는 걸
          보내기 전에 고지한다(사용자 확정: "첫대화 엔터 누르면 그때 차감
          경고창"). 실제 차감은 백엔드가 첫 /chat에서 한다 - 여기서는 "계속"이
          그 첫 /chat을 발화시킬 뿐이다. */}
      {chargeGateText !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="무료권 차감 확인"
        >
          <div className="w-full max-w-sm rounded-xl border border-rule bg-ink-800 p-5 shadow-lg">
            <h2 className="font-serif text-title font-bold text-text-hi">별자리 하나를 시작할까요?</h2>
            <p className="mt-2 font-sans text-body-sm leading-relaxed text-text-lo">
              이 대화를 시작하면 별자리 <b className="text-text-hi">1개</b>가 쓰여요. 대화를 마치고
              별자리를 완성하는 것까지 이 하나에 포함돼요.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChargeGateText(null)}
                className="rounded-md px-3 py-1.5 font-sans text-body-sm text-text-lo transition-colors hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const text = chargeGateText;
                  setChargeGateText(null);
                  void sendMessage(text, { confirmed: true });
                }}
                className="cta-ink rounded-md bg-spec-b px-4 py-1.5 font-sans text-body-sm font-semibold text-ink-900 transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
              >
                시작하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 우상단 "기존 별자리가 있어요" 배지 - 빠져나갈 곳(onDismiss)이 있을
          때만 뜬다. 대화는 그대로 진행 중일 수 있으므로 대화 UI 위(z-20)에
          겹쳐도 방해되지 않게 작고 조용하게 둔다. */}
      {existingNotice && onDismiss && (
        <button
          type="button"
          onClick={handleDismiss}
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
              {pastTurns.map((t, idx) => {
                const answerIndex = t.answerIndex;
                return (
                  <div key={idx} className="flex flex-col gap-3 opacity-[0.45]">
                    <div className="flex items-start gap-3">
                      <StarGlyph size={16} className="mt-1 shrink-0" />
                      <p className="whitespace-pre-wrap text-base leading-[1.7] text-text-hi">
                        {t.question}
                      </p>
                    </div>
                    {t.answer && (
                      <div className="flex max-w-[480px] flex-col items-end gap-1 self-end">
                        <p className="whitespace-pre-wrap rounded-md border border-rule bg-ink-800 px-[18px] py-3 text-[15px] leading-[1.65] text-text-hi">
                          {t.answer}
                        </p>
                        {/* 답 번복 - 이 답 직전으로 대화를 되감고 입력창에
                            프리필한다(reviseAnswer). 이후 답들은 함께 사라지므로
                            라벨로 그 사실을 미리 알린다. */}
                        {answerIndex !== undefined && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => reviseAnswer(answerIndex)}
                            aria-label="이 답부터 다시 답하기 (이후 대화는 사라져요)"
                            title="이 답부터 다시 답하기 - 이후 대화는 사라져요"
                            className="font-sans text-caption text-text-lo underline-offset-2 transition-colors hover:text-text-hi hover:underline disabled:opacity-50"
                          >
                            수정
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

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
                        <div className="flex flex-wrap items-center gap-2.5">
                          {[...options, OTHER_CHIP_LABEL].map((opt) => {
                            const isOther = opt === OTHER_CHIP_LABEL;
                            const selected = isOther
                              ? otherSelected
                              : selectedOptions.includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                disabled={inputDisabled}
                                aria-pressed={selected}
                                onClick={() => (isOther ? toggleOther() : toggleOption(opt))}
                                className={cn(
                                  "rounded-full border px-4 py-2 text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50",
                                  selected
                                    ? "border-lit bg-lit/15 text-text-hi"
                                    : "border-rule text-text-lo hover:border-text-hi/30 hover:text-text-hi"
                                )}
                              >
                                {opt}
                              </button>
                            );
                          })}
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
              {/* 칩 wrap과 무관하게 항상 온전히 보이는 "선택 완료" - 칩이 여러
                  줄로 늘어나도 이 자리는 입력창 바로 위에 고정돼 잘리지 않는다. */}
              {(selectedOptions.length > 0 || otherSelected) && (
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    disabled={inputDisabled || composeMessage() === ""}
                    onClick={() => void sendMessage(composeMessage())}
                    className="rounded-full border border-lit bg-lit/15 px-4 py-2 text-[13.5px] font-medium text-text-hi transition-colors hover:bg-lit/25 disabled:pointer-events-none disabled:opacity-50"
                  >
                    선택 완료
                  </button>
                </div>
              )}
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
                  placeholder={otherSelected ? "직접 입력해줘…" : "답을 입력하세요…"}
                  aria-label="메시지 입력"
                  className="min-w-0 flex-1 rounded-full border border-rule bg-ink-800 px-[22px] py-[15px] font-sans text-[15px] text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={inputDisabled || composeMessage() === ""}
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
  // SVG viewBox를 화면에 늘리면(preserveAspectRatio none) 원이 타원 얼룩이 된다
  // (DraftReviewStage에서 실측) - % 좌표의 div 점으로 그려 항상 동그란 별을 유지한다.
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {BACKGROUND_STARS.map((s, idx) => (
        <span
          key={idx}
          className="absolute rounded-full bg-text-hi"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r * 2,
            height: s.r * 2,
            opacity: s.o,
          }}
        />
      ))}
    </div>
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
  // 로딩(랜덤 별자리 점등 모션) + 사용법 캐러셀 - 5분급 대기를 안내로 채운다
  // (사용자 지시). 작은 화면에서는 세로 스크롤로 전체를 볼 수 있게 한다.
  return (
    <div className="fixed inset-0 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center">
        <GeneratingGuide />
      </div>
    </div>
  );
}
