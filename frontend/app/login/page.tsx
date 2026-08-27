"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

/** Firebase Auth 에러 코드를 한국어 문구로 변환한다. */
function toKoreanError(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
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

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      router.push(u.yonseiVerified ? "/" : "/verify");
    } catch (err) {
      setError(toKoreanError(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="p-8">
        <h1 className="font-serif text-display font-bold text-text-hi">로그인</h1>
        <p className="mb-6 mt-[7px] text-body-sm text-text-lo">
          연세대 학부생들의 별자리 커뮤니티로 돌아오세요
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            id="login-email"
            label="이메일"
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Field
            id="login-password"
            label="비밀번호"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="text-caption text-spec-m">{error}</p>}
          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            disabled={pending || !email.trim() || !password}
            className="mt-1"
          >
            {pending ? "로그인 중…" : "로그인"}
          </Button>
        </form>
        <p className="mt-4 text-center text-caption text-text-lo">
          <Link href="/reset-password" className="font-semibold text-spec-b">
            비밀번호를 잊으셨나요?
          </Link>
        </p>
        <p className="mt-2 text-center text-body-sm text-text-lo">
          아직 계정이 없나요?{" "}
          <Link href="/signup" className="font-semibold text-spec-b">
            회원가입
          </Link>
        </p>
      </Card>
    </div>
  );
}
