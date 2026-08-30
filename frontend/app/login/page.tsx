"use client";

/*
 * 로그인 - 랜딩(종이 성도)과 같은 세계에 놓인 화면.
 *
 * 사용자 지시: "랜딩페이지에서 망원경 들여다보기 누르면 랜딩페이지와 톤앤
 * 매너 비슷한 로그인창이 떴으면 좋겠어 (...) 망원경 확대되는 거 다음에는 바로
 * 깜깜한 LLM대화가 나왔으면 좋겠거든."
 *
 * 그래서 진입 순서가 이렇게 정리됐다:
 *   랜딩(밝은 종이) -> [망원경 들여다보기] -> 이 화면(같은 종이, 접안렌즈가 옆에)
 *   -> 로그인 성공 -> 접안렌즈 대기 스테이지(독립 화면, 렌즈가 가운데 + 문구)
 *   -> 렌즈 클릭 시 명->암 전환 -> 어두운 관측 화면.
 * 랜딩에 있던 "접안렌즈 대기" 스테이지(원래 b6bbeb0에서 만들어짐)는 bf56d8d에서
 * "로그인 화면이 그 자리를 대신한다"는 판단으로 삭제됐었으나, 로그인 폼 위로
 * 렌즈만 갑자기 커지는 회귀로 이어져 사용자 지적으로 복원했다(ApertureStage) -
 * 로그인 성공 후에도 독립된 스테이지로 존재해야 한다.
 *
 * 도착지 규칙(사용자 확정): 보내진 곳이 있으면 그리로(내비게이션 의도 우선 -
 * "커뮤니티 가려는데 LLM이 뜨면 안 된다"), 없으면 /constellation/new. 거기서
 * 만들던 별자리가 있으면 이어서 열리고, 정말 처음인 사용자에게만 LLM 대화가
 * 뜬다(app/constellation/new/page.tsx의 boot 규칙, fc8b862).
 *
 * 색은 랜딩과 같은 이유로 전부 인라인 var(--paper-*)다 - 신규 Tailwind 토큰은
 * dev 서버 재시작 전 미컴파일이라 흰 지면이 어둡게 뚫리는 실사고가 있었다.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

/** Firebase Auth 에러 코드를 한국어 문구로 변환한다. */
function toKoreanError(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "이메일 또는 비밀번호가 올바르지 않아요.";
    case "auth/invalid-email":
      return "이메일 형식이 올바르지 않아요.";
    case "auth/too-many-requests":
      return "시도가 너무 많아요. 잠시 후 다시 시도해주세요.";
    case "auth/user-disabled":
      return "비활성화된 계정이에요.";
    default:
      return "로그인에 실패했어요. 다시 시도해주세요.";
  }
}

/**
 * next 파라미터가 안전한 내부 경로일 때만 리다이렉트에 사용한다.
 * "/"로 시작하지 않거나 "//"로 시작(프로토콜 상대 URL)하거나
 * /login·/signup으로 시작하면 open redirect 위험이 있어 무시한다.
 */
function isSafeNextPath(next: string | null): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/login") || next.startsWith("/signup")) return false;
  return true;
}

/** 오류 문구용 잉크 섞은 붉은색 - spec-m 원색은 밝은 종이 위에서 대비가
 * 모자란다(2.6:1). 새 hex를 만들지 않고 팔레트 안에서 섞어 쓴다. */
const PAPER_DANGER = "color-mix(in srgb, var(--spec-m) 55%, var(--paper-ink))";

/** 접안렌즈 - 랜딩에서 이어지는 망원경 도상. 안쪽 어두운 시야가 로그인 성공 시
 * 그대로 화면을 덮는 전환으로 이어진다. size에 문자열("100%" 등)을 주면 감싸는
 * 요소(대기 스테이지의 apertureReveal 버튼) 크기에 그대로 맞춰진다. children을
 * 주면 시야 한가운데에 문구를 얹는다(대기 스테이지 전용 - 사이드바 장식판은
 * 안 씀 -> aria-hidden 유지, 문구가 있을 때만 접근 트리에 노출). */
function Eyepiece({ size, children }: { size: number | string; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden={children ? undefined : true}
      className="relative shrink-0"
      // apertureReveal 키프레임은 쓰지 않는다 - 그 안에 translate(-50%,-50%)가
      // 들어 있어(랜딩의 화면 중앙 고정 요소 전용) 흐름 배치인 여기서는 도상이
      // 제 칸 밖으로 밀려 폼과 겹친다(실측). 이 화면의 연출은 로그인 성공 시의
      // 명->암 전환 하나로 충분하다.
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 640 640" className="absolute inset-0 h-full w-full" fill="transparent">
        <circle cx="320" cy="320" r="316" stroke="var(--paper-line)" strokeWidth="1" fill="transparent" />
        <circle cx="320" cy="320" r="300" stroke="var(--paper-soft)" strokeWidth="1.5" fill="transparent" />
        <g stroke="var(--paper-soft)" strokeWidth="1.5">
          <line x1="320" y1="6" x2="320" y2="20" />
          <line x1="320" y1="620" x2="320" y2="634" />
          <line x1="6" y1="320" x2="20" y2="320" />
          <line x1="620" y1="320" x2="634" y2="320" />
        </g>
      </svg>
      <div
        className="absolute overflow-hidden rounded-full"
        style={{
          inset: "3.75%",
          background: "radial-gradient(circle at 46% 42%, #0b1024 0%, var(--ink-900) 70%)",
        }}
      >
        <svg viewBox="0 0 592 592" className="absolute inset-0 h-full w-full">
          <g fill="#E8EAF2">
            <circle cx="168" cy="204" r="1.6" opacity="0.9" />
            <circle cx="352" cy="140" r="1.2" opacity="0.6" />
            <circle cx="452" cy="300" r="1.8" opacity="0.85" />
            <circle cx="240" cy="392" r="1.2" opacity="0.55" />
            <circle cx="388" cy="452" r="1.4" opacity="0.7" />
            <circle cx="120" cy="330" r="1" opacity="0.45" />
            <circle cx="300" cy="256" r="2.2" opacity="1" />
            <circle cx="500" cy="180" r="1" opacity="0.5" />
          </g>
        </svg>
        {children && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** 접안렌즈 대기 스테이지(시안 보드 2, bf56d8d에서 사라졌다가 사용자 지적으로
 * 복원) - 로그인 폼과는 다른 독립된 화면이다. 로그인 성공 직후 폼 위로 렌즈가
 * 갑자기 커지는 대신, 이 화면이 폼을 완전히 대체하고 렌즈를 눌러야 명->암
 * 전환(zoom)이 시작된다. */
function ApertureStage({ zooming, onEnter, onZoomEnd }: { zooming: boolean; onEnter: () => void; onZoomEnd: () => void }) {
  return (
    <div className="fixed inset-0 z-[65] overflow-hidden" style={{ backgroundColor: "var(--paper)" }}>
      {/* 가장자리 비네트: 명->암 전환의 중간 순간 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 900px 640px at 50% 50%, rgba(4, 6, 11, 0) 55%, rgba(4, 6, 11, 0.12) 100%)",
        }}
      />

      {/* 접안렌즈: 화면 한가운데 뚫린 우주. 클릭이 유일한 다음 행동. */}
      <button
        type="button"
        onClick={onEnter}
        disabled={zooming}
        aria-label="망원경 들여다보기 시작"
        className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-spec-b"
        style={{
          width: "min(640px, 86vmin)",
          height: "min(640px, 86vmin)",
          animation: "apertureReveal 500ms cubic-bezier(0.4, 0, 0.2, 1) both",
        }}
      >
        <Eyepiece size="100%">
          <span
            className="font-serif text-[22px] leading-[1.55] md:text-[27px]"
            style={{ color: "#E8EAF2", wordBreak: "keep-all" }}
          >
            망원경에 눈을 대면
            <br />
            별자리로 이어질게요
          </span>
        </Eyepiece>
      </button>

      <p
        className="absolute bottom-12 left-1/2 -translate-x-1/2 text-body-sm"
        style={{ color: "var(--paper-lo)" }}
      >
        망원경에 눈을 대는 중&hellip;
      </p>

      {/* 확대 전환: 접안렌즈 크기에서 시작해 화면을 덮으면 목적지로 이동 (1회성) */}
      {zooming && (
        <div
          aria-hidden
          onAnimationEnd={onZoomEnd}
          className="fixed left-1/2 top-1/2 z-[70] h-[250vmax] w-[250vmax] rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 46%, #0b1024 0%, var(--ink-900) 60%)",
            animation: "apertureOpen 700ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
          }}
        />
      )}
    </div>
  );
}

/** 종이 위 입력칸 - 다크월드용 Field 컴포넌트 대신 이 세계의 재질로 그린다. */
function PaperField({
  id,
  label,
  ...rest
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium" style={{ color: "var(--paper-lo)" }}>
        {label}
      </label>
      <input
        id={id}
        className="w-full rounded-md border px-3.5 py-2.5 text-body outline-none transition-colors"
        style={{
          backgroundColor: "var(--paper)",
          borderColor: "var(--paper-line)",
          color: "var(--paper-ink)",
          caretColor: "var(--paper-ink)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--paper-ink)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--paper-line)";
        }}
        {...rest}
      />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 로그인 성공 -> 접안렌즈 대기 스테이지(독립 화면) -> 렌즈 클릭 시 명->암
  // 전환(zoom) -> 목적지. 폼 화면 위로 렌즈가 갑자기 커지는 것을 막기 위해
  // 대기 스테이지를 폼과 별개의 화면으로 둔다(사용자 지적으로 복원).
  const [stage, setStage] = useState<"form" | "aperture" | "zoom">("form");
  const [destination, setDestination] = useState<string | null>(null);

  const nextParam = searchParams.get("next");

  useEffect(() => {
    router.prefetch("/constellation/new");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || stage !== "form") return;
    setPending(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      // 인증 전이면 인증 화면이 먼저. 그 외에는 보내진 곳(내비게이션 의도)을
      // 우선하고, 없을 때만 캔버스로 - 거기서 "이어서 열기 / 첫 사용자 대화"가
      // 갈린다(사용자 확정 규칙: 쓰던 사람에게 LLM이 튀어나오면 안 된다).
      if (!u.yonseiVerified) setDestination("/verify");
      else if (isSafeNextPath(nextParam)) setDestination(nextParam);
      else setDestination("/constellation/new");
      setStage("aperture");
    } catch (err) {
      setError(toKoreanError(err));
      setPending(false);
    }
  }

  return (
    <div
      className="paper-surface bg-paper-grid fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden"
      style={{ backgroundColor: "var(--paper)", color: "var(--paper-ink)" }}
    >
      {/* 성도 인쇄물의 외곽 계선 - 랜딩과 같은 판형 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-4 border md:inset-7"
        style={{ borderColor: "var(--paper-line)" }}
      />

      {/* 폼 화면 - 로그인 성공 후에는 접안렌즈 대기 스테이지가 이 화면을
          완전히 대체한다(위로 겹치지 않음, 사용자 지적으로 정정). */}
      {stage === "form" && (
      <>
      <header className="absolute inset-x-4 top-4 z-10 flex items-center justify-between px-6 py-5 md:inset-x-7 md:top-7 md:px-9">
        <Link
          href="/"
          className="font-serif text-title font-bold tracking-wide no-underline"
          style={{ color: "var(--paper-ink)" }}
        >
          OurLab
        </Link>
        <Link href="/demo" className="text-body-sm" style={{ color: "var(--paper-lo)" }}>
          둘러보기
        </Link>
      </header>

      <div className="flex min-h-full items-center py-24 lg:py-0">
        <div className="mx-auto grid w-full max-w-[1080px] items-center gap-12 px-10 md:px-16 lg:grid-cols-[minmax(0,420px)_auto] lg:gap-20">
          <div className="flex flex-col gap-7">
            {/* 모바일: 접안렌즈 축소판이 먼저 온다 */}
            <div className="self-center lg:hidden">
              <Eyepiece size={168} />
            </div>

            <div className="flex flex-col gap-2.5">
              <h1
                className="font-serif text-[30px] font-bold leading-[1.35] md:text-[34px]"
                style={{ color: "var(--paper-ink)", wordBreak: "keep-all" }}
              >
                망원경 앞에 서기
              </h1>
              <p className="text-body leading-relaxed" style={{ color: "var(--paper-lo)", wordBreak: "keep-all" }}>
                연세대 학부생 계정으로 들어가면, 이어서 별자리를 그릴 수 있어요.
              </p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <PaperField
                id="login-email"
                label="이메일"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@yonsei.ac.kr"
              />
              <PaperField
                id="login-password"
                label="비밀번호"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />

              {error && (
                <p role="alert" className="text-body-sm" style={{ color: PAPER_DANGER }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending || stage !== "form" || !email.trim() || !password}
                className="cta-ink mt-1 flex items-center justify-center gap-2.5 rounded-full px-7 py-[15px] text-body font-medium leading-none disabled:opacity-45"
                style={{ backgroundColor: "var(--paper-ink)", color: "var(--paper)" }}
              >
                {pending ? "확인하는 중…" : "들여다보기"}
              </button>
            </form>

            <div className="flex flex-col gap-2 text-body-sm" style={{ color: "var(--paper-lo)" }}>
              <p>
                아직 계정이 없나요?{" "}
                <Link href="/signup" className="font-medium" style={{ color: "var(--paper-ink)" }}>
                  회원가입
                </Link>
              </p>
              <Link href="/reset-password" className="self-start" style={{ color: "var(--paper-lo)" }}>
                비밀번호를 잊으셨나요?
              </Link>
            </div>
          </div>

          {/* 데스크톱: 접안렌즈 원본 크기 + 도판 라벨(랜딩 FIG. 1의 짝) */}
          <div className="relative hidden lg:block">
            <Eyepiece size={400} />
            <p
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tracking-[0.1em]"
              style={{ color: "var(--paper-lo)" }}
            >
              <span className="font-mono">FIG. 2</span> — 접안렌즈
            </p>
          </div>
        </div>
      </div>

      <p
        className="px-10 pb-10 pt-2 text-caption md:px-16 lg:absolute lg:bottom-12 lg:left-16 lg:p-0"
        style={{ color: "var(--paper-lo)" }}
      >
        연세대학교 재학생 인증 기반 · OurLab
      </p>
      </>
      )}

      {/* 접안렌즈 대기 스테이지: 로그인 성공 직후 폼을 대체하는 독립 화면.
          렌즈를 눌러야 명->암 전환(zoom)이 시작되고, 그 전환이 끝나면 그때
          목적지로 이동한다(reduced-motion이면 전역 규칙이 duration을 줄여
          즉시 끝나지만 onAnimationEnd 라우팅은 그대로 동작). */}
      {stage !== "form" && destination && (
        <ApertureStage
          zooming={stage === "zoom"}
          onEnter={() => setStage("zoom")}
          onZoomEnd={() => router.push(destination)}
        />
      )}
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams는 클라이언트에서 요청 시점 값을 읽으므로
  // App Router 관례에 따라 Suspense 경계로 감싼다.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
