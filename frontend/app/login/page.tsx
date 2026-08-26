"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { ApiError, postLogin } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const me = await postLogin(username.trim(), password);
      await refresh();
      router.push(me.yonsei_verified ? "/" : "/verify");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "로그인에 실패했어요. 다시 시도해주세요.");
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
            id="login-username"
            label="아이디"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
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
            disabled={pending || !username.trim() || !password}
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
