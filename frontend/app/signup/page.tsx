"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, postLogin, postSignup, postVerifyEmail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const INPUT_CLS =
  "w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]";

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
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)] px-4 py-16">
      <div className="w-full max-w-[440px] rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] p-8 shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[10px]">
        <h1 className="font-serif text-[26px] font-bold text-moss-100">
          {step === "account" ? "새 씨앗 계정 만들기" : "이메일 인증"}
        </h1>
        <p className="mb-6 mt-[7px] text-[12.5px] leading-relaxed text-moss-600">
          {step === "account"
            ? "연세대 학부생 전용 커뮤니티예요. 가입 후 학교 이메일 또는 학생증으로 인증해요."
            : `${email} 로 보낸 6자리 코드를 입력해주세요. (10분 유효)`}
        </p>

        {step === "account" ? (
          <form onSubmit={submitAccount} className="flex flex-col gap-3">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디 (영문 소문자·숫자·_ 4~20자)"
              autoComplete="username"
              className={INPUT_CLS}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 (8자 이상, 문자+숫자)"
              autoComplete="new-password"
              className={INPUT_CLS}
            />
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              className={INPUT_CLS}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              autoComplete="email"
              className={INPUT_CLS}
            />
            {isYonseiEmail && (
              <p className="text-[11.5px] text-bean-200">
                🌱 연세대 이메일이네요 — 이메일 인증만으로 학부생 인증까지 한 번에 끝나요.
              </p>
            )}
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="닉네임"
              maxLength={30}
              className={INPUT_CLS}
            />
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEmoji(c)}
                  className={`flex h-9 w-9 items-center justify-center rounded-[10px] border text-[17px] transition-colors ${
                    emoji === c
                      ? "border-[rgba(143,220,138,.5)] bg-[rgba(143,220,138,.16)]"
                      : "border-[rgba(143,220,138,.15)] bg-transparent hover:bg-[rgba(143,220,138,.08)]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="mt-1 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-moss-500">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-bean-500"
              />
              <span>
                아이디·이메일·(선택 시) 학생증 이미지를 회원 확인 목적으로 수집·이용하는 데
                동의합니다. 학생증 이미지는 심사 즉시 파기돼요.{" "}
                <Link href="/privacy" className="font-semibold">
                  개인정보 처리방침
                </Link>
              </span>
            </label>
            {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="mt-1 w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {pending ? "심는 중…" : "가입하고 인증 코드 받기"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-3">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="인증 코드 6자리"
              inputMode="numeric"
              className={`${INPUT_CLS} text-center text-[20px] tracking-[.4em]`}
            />
            {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
            <button
              type="submit"
              disabled={pending || code.length !== 6}
              className="w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {pending ? "확인 중…" : "인증하기"}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-[12.5px] text-moss-600">
          이미 계정이 있나요?{" "}
          <Link href="/login" className="font-semibold">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
