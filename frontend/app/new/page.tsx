"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import FieldChips from "@/components/FieldChips";
import SourceBadges from "@/components/SourceBadges";
import { Button, Card, Chip, Field, ProgressBar, TargetIcon } from "@/components/ui";
import { ApiError, generatePreview, postChat, postPlant } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import type { ChatMessageIn, ChatRole, RoadmapPreviewOut } from "@/lib/types";

const TYPING_DELAY_MS = 550;

// The backend reports a status string, not a percentage. Approximate from
// elapsed time against the ~6 min observed end-to-end web-search run, and
// cap below 100 so the bar never claims completion before the job returns.
const PREVIEW_ETA_MS = 6 * 60 * 1000;

const GREETING =
  "안녕하세요, 씨앗을 심으러 오셨군요.\n이루고 싶은 목표를 편하게 적어주세요. 콩나무가 자랄 길(마일스톤)을 그려드릴게요.";

function Bubble({ role, content }: { role: ChatRole; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`mb-3.5 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-line rounded-lg border px-4 py-3 text-body text-content-primary sm:max-w-[72%]",
          isUser ? "border-line-strong bg-goal/18" : "border-line bg-surface-raised"
        )}
      >
        {content}
      </div>
    </div>
  );
}

function RootingIndicator({ label }: { label: string }) {
  return (
    <div className="mb-3.5 mt-1 flex items-center gap-1.5 text-caption text-content-muted">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rounded-full bg-growth"
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
    <Card className="mb-3.5 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="bloom" selected>
          <TargetIcon size={14} />
          대목표 · {preview.career_goal.title}
        </Chip>
        <span className="text-caption text-content-muted">
          {preview.career_goal.is_new ? "새 대목표로 만들어요" : "기존 대목표 아래에 심어요"}
        </span>
        {many && (
          <span className="text-caption text-content-secondary">
            {preview.roadmaps.length}그루의 콩나무를 함께 심어요
          </span>
        )}
      </div>
      <div className="flex flex-col gap-5">
        {preview.roadmaps.map((roadmap, ri) => (
          <div key={ri} className="min-w-0">
            <h2 className="mb-2 font-serif text-heading font-bold text-content-primary">
              {many ? `${ri + 1}. ` : ""}
              {roadmap.title}
            </h2>
            <ol className="flex flex-col gap-2.5">
              {roadmap.milestones.map((m, i) => (
                <li key={i} className="min-w-0 rounded-md border border-line bg-white/6 px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-body-sm font-semibold text-content-primary">
                      {i + 1}. {m.title}
                    </span>
                    <span className="shrink-0 text-caption text-content-muted">
                      ~{formatDue(m.due_date)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-caption text-content-secondary">
                    {m.description}
                  </p>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer select-none text-caption text-goal-bright">
                      자세한 가이드 보기
                    </summary>
                    <p className="mt-1.5 whitespace-pre-line break-words text-caption leading-relaxed text-content-secondary">
                      {m.detail}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-4 text-caption text-content-muted">
        마음에 들면 아래 버튼으로 씨앗을 심어주세요. 심은 뒤에도 각 마일스톤의 가이드는 언제든 볼 수 있어요.
      </p>
    </Card>
  );
}

export default function NewRoadmapPage() {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();

  const [goalRawText, setGoalRawText] = useState("");
  const [fieldCodes, setFieldCodes] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessageIn[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState<RoadmapPreviewOut | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewPhase, setPreviewPhase] = useState<"pending" | "running" | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const [planting, setPlanting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const previewAbort = useRef<AbortController | null>(null);

  // 페이지를 벗어나면 진행 중인 프리뷰 폴링을 멈춘다.
  useEffect(() => () => previewAbort.current?.abort(), []);

  // 씨앗 심기는 연세대 인증 필수: 미로그인 → 로그인, 미인증 → 인증 페이지로.
  useEffect(() => {
    if (authLoading) return;
    if (!me) router.push("/login");
    else if (!me.yonsei_verified) router.push("/verify");
  }, [authLoading, me, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, done, previewing, preview, planting]);

  // 진행률 표시용 경과 시간 — 폴링 자체와는 무관한 화면 전용 타이머다.
  useEffect(() => {
    if (!previewing) {
      setPreviewElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setPreviewElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [previewing]);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewFailed(false);
    setError(null);
    setPreviewPhase("pending");
    const controller = new AbortController();
    previewAbort.current = controller;
    try {
      const res = await generatePreview(goalRawText, messages, fieldCodes, {
        signal: controller.signal,
        onStatus: (s) => {
          if (s === "pending" || s === "running") setPreviewPhase(s);
        },
      });
      setPreview(res);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // 페이지 이탈
      setPreviewFailed(true);
      setError(err instanceof ApiError ? err.detail : "로드맵 초안을 그리지 못했어요.");
    } finally {
      if (previewAbort.current === controller) previewAbort.current = null;
      setPreviewing(false);
      setPreviewPhase(null);
    }
  }, [goalRawText, messages, fieldCodes]);

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
  const previewStatusLabel =
    previewPhase === "running"
      ? "웹을 검색하며 로드맵 초안을 그리는 중… (몇 분 걸릴 수 있어요)"
      : "지금까지 들은 이야기로 로드맵 초안을 준비하는 중… (몇 분 걸릴 수 있어요)";
  const previewApproxPct = Math.min(95, (previewElapsedMs / PREVIEW_ETA_MS) * 100);

  if (authLoading || !me?.yonsei_verified) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="animate-pulse text-body-sm text-content-muted">확인 중…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col">
      <h1 className="font-serif text-display font-bold text-content-primary">새 씨앗 심기</h1>
      <p className="mb-7 mt-[7px] text-body-sm text-content-secondary">
        목표를 말해주면 AI가 콩나무가 자랄 길을 그려드려요
      </p>

      <Bubble role="assistant" content={GREETING} />
      {/* 분야는 초안을 그리기 전까지 언제든 바꿀 수 있다 — 초안이 나오면 감춘다. */}
      {!preview && !previewing && (
        <FieldChips selected={fieldCodes} onChange={setFieldCodes} disabled={planting} />
      )}
      {started && <Bubble role="user" content={goalRawText} />}
      {messages.map((m, i) => (
        <Bubble key={i} role={m.role} content={m.content} />
      ))}
      {typing && <RootingIndicator label="뿌리를 내리는 중…" />}
      {previewing && (
        <div className="mb-3.5">
          <ProgressBar tone="altitude" value={previewApproxPct} />
          <p className="mt-2 text-caption text-content-muted">{previewStatusLabel}</p>
        </div>
      )}
      {planting && <RootingIndicator label="씨앗을 심는 중…" />}
      {preview && <Bubble role="assistant" content={preview.briefing} />}
      {preview && <SourceBadges urls={preview.source_urls} />}
      {preview && <RoadmapPreviewPanel preview={preview} />}
      {error && <p className="mb-3 text-body-sm text-wither">{error}</p>}
      <div ref={bottomRef} />

      <div className="sticky bottom-[calc(var(--tabbar-h)+var(--safe-bottom))] mt-auto bg-earth-base/95 pt-4 backdrop-blur-sm md:bottom-0">
        {preview && !previewing && (
          <Button
            variant="primary"
            fullWidth
            onClick={plant}
            disabled={planting}
            className="mb-2.5"
          >
            {planting
              ? "심는 중…"
              : preview.roadmaps.length > 1
                ? `${preview.roadmaps.length}그루 함께 심기`
                : "이 로드맵으로 씨앗 심기"}
          </Button>
        )}
        {previewFailed && !previewing && (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => void runPreview()}
            className="mb-2.5"
          >
            로드맵 다시 그리기
          </Button>
        )}
        <form
          className="flex items-end gap-2 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Field
            id="new-chat-input"
            label={started ? "답변" : "이루고 싶은 목표"}
            className="flex-1"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              started ? "답변을 입력해주세요" : "예: 3학년 여름에 데이터 분석 인턴 하고 싶어"
            }
            disabled={done || planting}
          />
          <Button type="submit" disabled={!input.trim() || typing || done || planting}>
            보내기
          </Button>
        </form>
      </div>
    </div>
  );
}
