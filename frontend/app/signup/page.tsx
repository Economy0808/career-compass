"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ApiError, postLogin, postSignup, postVerifyEmail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const EMOJI_CHOICES = ["🌱", "🧭", "🦉", "🐿️", "🌙", "🍀", "🦊", "📚"];

type Step = "account" | "code";

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useAuth();

  const [step, setStep] = useState<Step>("account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [emoji, setEmoji] = useState("🌱");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isYonseiEmail = email.trim().toLowerCase().endsWith("@yonsei.ac.kr");

  function validateAccount(): string | null {
    if (!/^[a-z0-9_]{4,20}$/.test(username))
      return "아이디는 영문 소문자·숫자·밑줄 4~20자예요.";
    if (password.length < 8) return "비밀번호는 8자 이상이어야 해요.";
    if (/^\d+$/.test(password) || /^[a-zA-Z]+$/.test(password))
      return "비밀번호는 문자와 숫자를 섞어주세요.";
    if (password !== passwordConfirm) return "비밀번호가 서로 달라요.";
    if (!displayName.trim()) return "닉네임을 입력해주세요.";
    if (!consent) return "개인정보 수집·이용에 동의해야 가입할 수 있어요.";
    return null;
  }

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = validateAccount();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await postSignup({
        username,
        password,
        email: email.trim(),
        display_name: displayName.trim(),
        avatar_emoji: emoji,
        consent,
      });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "가입에 실패했어요. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await postVerifyEmail(email.trim(), code.trim());
      // 방금 입력한 자격증명으로 바로 로그인해서 연세 인증 단계로 넘어간다.
      const me = await postLogin(username, password);
      await refresh();
      router.push(me.yonsei_verified ? "/" : "/verify");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "인증에 실패했어요. 코드를 다시 확인해주세요."
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="p-8">
        <h1 className="font-serif text-display font-bold text-text-hi">
          {step === "account" ? "새 계정 만들기" : "이메일 인증"}
        </h1>
        <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-text-lo">
          {step === "account"
            ? "연세대 학부생 전용 커뮤니티예요. 가입 후 학교 이메일 또는 학생증으로 인증해요."
            : `${email} 로 보낸 6자리 코드를 입력해주세요. (10분 유효)`}
        </p>

        {step === "account" ? (
          <form onSubmit={submitAccount} className="flex flex-col gap-3">
            <Field
              id="signup-username"
              label="아이디 (영문 소문자·숫자·_ 4~20자)"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <Field
              id="signup-password"
              label="비밀번호 (8자 이상, 문자+숫자)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Field
              id="signup-password-confirm"
              label="비밀번호 확인"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
            />
            <Field
              id="signup-email"
              label="이메일"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {isYonseiEmail && (
              <p className="text-caption text-lit">
                ✨ 연세대 이메일이네요 — 이메일 인증만으로 학부생 인증까지 한 번에 끝나요.
              </p>
            )}
            <Field
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
                      ? "border-spec-b bg-spec-b/15 text-spec-b"
                      : "border-rule bg-transparent hover:bg-spec-b/8"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="mt-1 flex cursor-pointer items-start gap-2 text-caption leading-relaxed text-text-lo">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-spec-b"
              />
              <span>
                아이디·이메일·(선택 시) 학생증 이미지를 회원 확인 목적으로 수집·이용하는 데
                동의합니다. 학생증 이미지는 심사 즉시 파기돼요.{" "}
                <Link href="/privacy" className="font-semibold text-spec-b">
                  개인정보 처리방침
                </Link>
              </span>
            </label>
            {error && <p className="text-caption text-spec-m">{error}</p>}
            <Button type="submit" variant="primary" size="md" fullWidth disabled={pending} className="mt-1">
              {pending ? "심는 중…" : "가입하고 인증 코드 받기"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-3">
            <Field
              id="signup-code"
              label="인증 코드 6자리"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              className="[&_input]:text-center [&_input]:text-title [&_input]:tracking-[.4em]"
            />
            {error && <p className="text-caption text-spec-m">{error}</p>}
            <Button type="submit" variant="primary" size="md" fullWidth disabled={pending || code.length !== 6}>
              {pending ? "확인 중…" : "인증하기"}
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-body-sm text-text-lo">
          이미 계정이 있나요?{" "}
          <Link href="/login" className="font-semibold text-spec-b">
            로그인
          </Link>
        </p>
      </Card>
    </div>
  );
}
