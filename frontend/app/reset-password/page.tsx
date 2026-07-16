"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, confirmPasswordReset, requestPasswordReset } from "@/lib/api";

const INPUT_CLS =
  "w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]";

type Step = "email" | "reset";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email.trim());
      setNotice(res.detail);
      setStep("reset");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "요청에 실패했어요.");
    } finally {
      setPending(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await confirmPasswordReset(email.trim(), code.trim(), newPassword);
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "재설정에 실패했어요.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)] px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] p-8 shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[10px]">
        <h1 className="font-serif text-[26px] font-bold text-moss-100">비밀번호 재설정</h1>
        <p className="mb-6 mt-[7px] text-[12.5px] leading-relaxed text-moss-600">
          {step === "email"
            ? "가입한 이메일로 6자리 재설정 코드를 보내드려요."
            : `${email} 로 보낸 코드와 새 비밀번호를 입력해주세요.`}
        </p>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-3">
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              autoComplete="email"
              className={INPUT_CLS}
            />
            {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
            <button
              type="submit"
              disabled={pending || !email.trim()}
              className="mt-1 w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {pending ? "보내는 중…" : "재설정 코드 받기"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="flex flex-col gap-3">
            {notice && <p className="text-[12px] text-bean-200">{notice}</p>}
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="인증 코드 6자리"
              inputMode="numeric"
              className={`${INPUT_CLS} text-center text-[18px] tracking-[.4em]`}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 (8자 이상, 문자+숫자)"
              autoComplete="new-password"
              className={INPUT_CLS}
            />
            {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
            <button
              type="submit"
              disabled={pending || code.length !== 6 || newPassword.length < 8}
              className="w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
            >
              {pending ? "재설정 중…" : "비밀번호 재설정"}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-[12.5px] text-moss-600">
          <Link href="/login" className="font-semibold">
            로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
