"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, postLogin } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const INPUT_CLS =
  "w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]";

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
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)] px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] p-8 shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[10px]">
        <h1 className="font-serif text-[26px] font-bold text-moss-100">로그인</h1>
        <p className="mb-6 mt-[7px] text-[12.5px] text-moss-600">
          연세대 학부생들의 콩나무 숲으로 돌아오세요
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="아이디"
            autoComplete="username"
            className={INPUT_CLS}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            className={INPUT_CLS}
          />
          {error && <p className="text-[12.5px] text-wither-300">{error}</p>}
          <button
            type="submit"
            disabled={pending || !username.trim() || !password}
            className="mt-1 w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60"
          >
            {pending ? "로그인 중…" : "로그인"}
          </button>
        </form>
        <p className="mt-4 text-center text-[12px] text-moss-700">
          <Link href="/reset-password" className="font-semibold">
            비밀번호를 잊으셨나요?
          </Link>
        </p>
        <p className="mt-2 text-center text-[12.5px] text-moss-600">
          아직 씨앗이 없나요?{" "}
          <Link href="/signup" className="font-semibold">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  );
}
