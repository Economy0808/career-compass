"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextParam = searchParams.get("next");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      if (!u.yonseiVerified) {
        router.push("/verify");
      } else {
        router.push(isSafeNextPath(nextParam) ? nextParam : "/");
      }
    } catch (err) {
      setError(toKoreanError(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[76dvh] w-full max-w-md flex-col justify-center">
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
        <p className="mt-2 text-center text-body-sm text-text-lo">
          <Link href="/constellation/new" className="font-semibold text-spec-b">
            로그인 없이 둘러보기
          </Link>
        </p>
      </Card>
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
