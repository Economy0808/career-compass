"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";

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
      // 이메일 인증 메일을 보냈으니, 안내와 다음 단계는 /verify에서 처리한다.
      router.push("/verify");
    } catch (err) {
      setError(toKoreanError(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[76dvh] w-full max-w-md flex-col justify-center">
      <Card className="p-8">
        <h1 className="font-serif text-display font-bold text-text-hi">새 계정 만들기</h1>
        <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-text-lo">
          연세대 학부생 전용 커뮤니티예요. 가입 후 이메일 인증과 학부생 인증을 거쳐요.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            id="signup-email"
            label="이메일"
            type="email"
            autoFocus
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
              이메일·닉네임·(선택 시) 학생증 이미지를 회원 확인 목적으로 수집·이용하는 데
              동의합니다. 학생증 이미지는 심사 즉시 파기돼요.{" "}
              <Link href="/privacy" className="font-semibold text-spec-b">
                개인정보 처리방침
              </Link>
            </span>
          </label>
          {error && <p className="text-caption text-spec-m">{error}</p>}
          <Button type="submit" variant="primary" size="md" fullWidth disabled={pending} className="mt-1">
            {pending ? "심는 중…" : "가입하기"}
          </Button>
        </form>

        <p className="mt-5 text-center text-body-sm text-text-lo">
          이미 계정이 있나요?{" "}
          <Link href="/login" className="font-semibold text-spec-b">
            로그인
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
