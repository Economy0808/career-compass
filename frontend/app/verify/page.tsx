"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  ApiError,
  postSchoolEmailRequest,
  postSchoolEmailVerify,
  postStudentCard,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Method = "school_email" | "student_card";

const LINK_PRIMARY =
  "flex-1 rounded-md border border-transparent bg-goal p-3 text-center text-body-sm font-bold text-white no-underline transition-[filter] duration-150 hover:brightness-110";
const LINK_SECONDARY =
  "rounded-md border border-line-strong bg-goal/12 p-3 text-center text-body-sm font-semibold text-goal-bright no-underline transition-colors hover:bg-goal/20";

export default function VerifyPage() {
  const router = useRouter();
  const { me, loading, refresh } = useAuth();

  const [method, setMethod] = useState<Method>("school_email");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !me) router.push("/login");
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div className="mx-auto w-full max-w-md py-16 text-center">
        <p className="animate-pulse text-body-sm text-content-secondary">확인 중…</p>
      </div>
    );
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await postSchoolEmailRequest(schoolEmail.trim());
      setCodeSent(true);
      setNotice("학교 이메일로 인증 코드를 보냈어요.");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "코드 발송에 실패했어요.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await postSchoolEmailVerify(code.trim());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "인증에 실패했어요.");
      setPending(false);
    }
  }

  async function uploadCard(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await postStudentCard(file);
      setNotice(res.detail);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "업로드에 실패했어요.");
    } finally {
      setPending(false);
    }
  }

  const body = me.yonsei_verified ? (
    <div className="text-center">
      <div className="text-5xl">🌳</div>
      <h2 className="mt-3 font-serif text-title font-bold text-content-primary">
        연세대 학부생 인증 완료!
      </h2>
      <p className="mt-2 text-body-sm text-content-secondary">
        {me.verification_method === "student_card"
          ? "학생증 심사가 승인됐어요."
          : "학교 이메일로 인증됐어요."}{" "}
        이제 나만의 별자리를 만들 수 있어요.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/constellation/new" className={LINK_PRIMARY}>
          별자리 생성하기
        </Link>
        <Link href="/" className={cn(LINK_SECONDARY, "flex-1")}>
          둘러보기
        </Link>
      </div>
    </div>
  ) : me.card_status === "pending" ? (
    <div className="text-center">
      <div className="text-5xl">🕰️</div>
      <h2 className="mt-3 font-serif text-title font-bold text-content-primary">학생증 심사 중</h2>
      <p className="mt-2 text-body-sm leading-relaxed text-content-secondary">
        운영자가 확인하는 대로 알려드릴게요 (보통 24시간 이내).
        <br />
        심사가 끝나면 이미지는 즉시 파기돼요. 그동안 숲 구경은 자유예요!
      </p>
      <Link href="/" className={cn(LINK_SECONDARY, "mt-6 block w-full")}>
        숲 구경하기
      </Link>
    </div>
  ) : (
    <>
      {me.card_status === "rejected" && (
        <p className="mb-4 rounded-md border border-wither/30 bg-wither/12 p-3 text-caption leading-relaxed text-wither">
          이전 학생증 심사가 반려됐어요. 학생증이 선명하게 보이는 사진으로 다시 올리거나, 학교
          이메일로 인증해주세요.
        </p>
      )}
      <div className="mb-5 flex gap-2">
        {(
          [
            ["school_email", "학교 이메일"],
            ["student_card", "학생증 사진"],
          ] as [Method, string][]
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={method === value ? "secondary" : "ghost"}
            onClick={() => {
              setMethod(value);
              setError(null);
              setNotice(null);
            }}
            className="flex-1 rounded-full"
          >
            {label}
          </Button>
        ))}
      </div>

      {method === "school_email" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={requestCode} className="flex items-end gap-2">
            <Field
              id="verify-school-email"
              label="학번@yonsei.ac.kr"
              type="email"
              value={schoolEmail}
              onChange={(e) => setSchoolEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={pending || !schoolEmail.trim()}
              className="shrink-0"
            >
              {codeSent ? "재발송" : "코드 받기"}
            </Button>
          </form>
          {codeSent && (
            <form onSubmit={verifyCode} className="flex flex-col gap-3">
              <Field
                id="verify-code"
                label="인증 코드 6자리"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                className="[&_input]:text-center [&_input]:text-title [&_input]:tracking-[.4em]"
              />
              <Button type="submit" variant="primary" size="md" fullWidth disabled={pending || code.length !== 6}>
                {pending ? "확인 중…" : "인증하기"}
              </Button>
            </form>
          )}
        </div>
      ) : (
        <form onSubmit={uploadCard} className="flex flex-col gap-3">
          <p className="text-caption leading-relaxed text-content-secondary">
            모바일 학생증 캡처 또는 실물 학생증 사진(JPEG/PNG, 5MB 이하)을 올려주세요. 운영자
            확인 후 <b className="text-content-primary">이미지는 즉시 파기</b>되고 승인 여부만 남아요.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="text-caption text-content-secondary file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-line-strong file:bg-goal/12 file:px-4 file:py-2 file:text-caption file:font-semibold file:text-goal-bright"
          />
          <Button type="submit" variant="primary" size="md" fullWidth disabled={pending}>
            {pending ? "올리는 중…" : "학생증 제출하기"}
          </Button>
        </form>
      )}
      {notice && !error && <p className="mt-3 text-caption text-growth-bright">{notice}</p>}
      {error && <p className="mt-3 text-caption text-wither">{error}</p>}
    </>
  );

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="p-8">
        {!me.yonsei_verified && me.card_status !== "pending" && (
          <>
            <h1 className="font-serif text-display font-bold text-content-primary">연세대 학부생 인증</h1>
            <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-content-secondary">
              별자리를 만들고 키우려면 인증이 필요해요. 둘 중 편한 방법을 골라주세요.
            </p>
          </>
        )}
        {body}
      </Card>
    </div>
  );
}
