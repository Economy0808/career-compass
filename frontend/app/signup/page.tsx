"use client";

/*
 * 회원가입(1단계 - 계정) - 로그인(login/page.tsx)과 같은 세계에 놓인 화면.
 *
 * 사용자 지시: "로그인페이지에서 회원가입 누르면 이 테마로 이동되는데, 로그인,
 * 회원가입, 이메일 인증 등등 서비스 이용 전 부대 작업은 모두 랜딩페이지와 같은
 * 테마의 페이지에서 진행해야해." 즉 다크월드 앱 셸(SideRail 포함) 안이 아니라
 * login/page.tsx와 동일한 밝은 종이 오버레이여야 한다 - 구조는 그쪽을 그대로 따른다.
 *
 * 2단계 구조(백엔드 계약 03-code-78): 여기서는 계정(이메일·비번·닉네임·이모지)과
 * 계정 레벨 동의만 받는다. 학번·학과·관심사 등 프로필과 국외이전 동의는 가입 직후
 * /onboarding에서 받는다(별도 라우트여야 온보딩 미완 유저를 되돌려 보낼 수 있다).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { PaperField } from "@/components/paper-form";

const EMOJI_CHOICES = ["🌱", "🧭", "🦉", "🐿️", "🌙", "🍀", "🦊", "📚"];

/** Firebase Auth 에러 코드를 한국어 문구로 변환한다. */
function toKoreanError(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "이미 가입된 이메일이에요.";
    case "auth/invalid-email":
      return "이메일 형식이 올바르지 않아요.";
    case "auth/weak-password":
      return "비밀번호가 너무 약해요.";
    default:
      return "가입에 실패했어요. 다시 시도해주세요.";
  }
}

/** 오류 문구용 잉크 섞은 붉은색 - login/page.tsx와 같은 이유(밝은 종이 위에서
 * spec-m 원색은 대비가 모자란다). 새 hex를 만들지 않고 팔레트 안에서 섞어 쓴다. */
const PAPER_DANGER = "color-mix(in srgb, var(--spec-m) 55%, var(--paper-ink))";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [emoji, setEmoji] = useState("🌱");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isYonseiEmail = email.trim().toLowerCase().endsWith("@yonsei.ac.kr");

  function validate(): string | null {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "이메일 형식이 올바르지 않아요.";
    if (password.length < 8) return "비밀번호는 8자 이상이어야 해요.";
    if (/^\d+$/.test(password) || /^[a-zA-Z]+$/.test(password))
      return "비밀번호는 문자와 숫자를 섞어주세요.";
    if (password !== passwordConfirm) return "비밀번호가 서로 달라요.";
    if (!displayName.trim()) return "닉네임을 입력해주세요.";
    if (!consent) return "개인정보 수집·이용에 동의해야 가입할 수 있어요.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signup(email.trim(), password, displayName.trim(), emoji, consent);
      // 계정이 생겼으니 이어서 프로필(학번·학과·관심사·국외이전 동의)을 받는다.
      // 이메일 인증 안내는 온보딩 다음 /verify에서 처리한다.
      router.push("/onboarding");
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
      {/* 성도 인쇄물의 외곽 계선 - 랜딩·로그인과 같은 판형 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-4 border md:inset-7"
        style={{ borderColor: "var(--paper-line)" }}
      />

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

      <div className="flex min-h-full items-center justify-center px-6 py-24">
        <div className="w-full max-w-[420px] rounded-lg border border-paper-line bg-paper p-8">
          <h1 className="font-serif text-display font-bold text-paper-ink">새 계정 만들기</h1>
          <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-paper-lo">
            연세대 학부생 전용 커뮤니티예요. 가입 후 프로필을 채우고 이메일·학부생 인증을 거쳐요.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <PaperField
              id="signup-email"
              label="이메일"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {isYonseiEmail && (
              <p className="text-caption text-paper-ink">
                ✨ 연세대 이메일이네요 — 이메일 인증만으로 학부생 인증까지 한 번에 끝나요.
              </p>
            )}
            <PaperField
              id="signup-password"
              label="비밀번호 (8자 이상, 문자+숫자)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <PaperField
              id="signup-password-confirm"
              label="비밀번호 확인"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
            />
            <PaperField
              id="signup-display-name"
              label="닉네임"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={30}
            />
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEmoji(c)}
                  aria-pressed={emoji === c}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border text-heading transition-colors",
                    emoji === c
                      ? "border-paper-ink bg-paper-soft text-paper-ink"
                      : "border-paper-line bg-transparent text-paper-lo hover:bg-paper-soft"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="mt-1 flex cursor-pointer items-start gap-2 text-caption leading-relaxed text-paper-lo">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-[var(--paper-ink)]"
              />
              <span>
                이메일·닉네임·(선택 시) 학생증 이미지를 회원 확인 목적으로 수집·이용하는 데
                동의합니다. 학생증 이미지는 심사 즉시 파기돼요.{" "}
                <Link href="/privacy" className="font-semibold text-paper-ink">
                  개인정보 처리방침
                </Link>
              </span>
            </label>
            {error && (
              <p role="alert" className="text-caption" style={{ color: PAPER_DANGER }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="cta-ink mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-paper-ink px-5 py-2.5 text-body-sm font-semibold text-paper transition-[filter,background-color] duration-150 disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? "심는 중…" : "다음 — 프로필 채우기"}
            </button>
          </form>

          <p className="mt-5 text-center text-body-sm text-paper-lo">
            이미 계정이 있나요?{" "}
            <Link href="/login" className="font-semibold text-paper-ink">
              로그인
            </Link>
          </p>
          <p className="mt-2 text-center text-body-sm text-paper-lo">
            <Link href="/demo" className="font-semibold text-paper-ink">
              로그인 없이 둘러보기
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
