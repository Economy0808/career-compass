"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { ApiError, confirmPasswordReset, requestPasswordReset } from "@/lib/api";

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
    <div className="mx-auto w-full max-w-md">
      <Card className="p-8">
        <h1 className="font-serif text-display font-bold text-text-hi">비밀번호 재설정</h1>
        <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-text-lo">
          {step === "email"
            ? "가입한 이메일로 6자리 재설정 코드를 보내드려요."
            : `${email} 로 보낸 코드와 새 비밀번호를 입력해주세요.`}
        </p>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-3">
            <Field
              id="reset-email"
              label="이메일"
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {error && <p className="text-caption text-spec-m">{error}</p>}
            <Button type="submit" variant="primary" size="md" fullWidth disabled={pending || !email.trim()} className="mt-1">
              {pending ? "보내는 중…" : "재설정 코드 받기"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="flex flex-col gap-3">
            {notice && <p className="text-caption text-lit">{notice}</p>}
            <Field
              id="reset-code"
              label="인증 코드 6자리"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              className="[&_input]:text-center [&_input]:text-title [&_input]:tracking-[.4em]"
            />
            <Field
              id="reset-new-password"
              label="새 비밀번호 (8자 이상, 문자+숫자)"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error && <p className="text-caption text-spec-m">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              disabled={pending || code.length !== 6 || newPassword.length < 8}
            >
              {pending ? "재설정 중…" : "비밀번호 재설정"}
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-body-sm text-text-lo">
          <Link href="/login" className="font-semibold text-spec-b">
            로그인으로 돌아가기
          </Link>
        </p>
      </Card>
    </div>
  );
}
