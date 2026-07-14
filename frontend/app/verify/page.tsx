"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  postSchoolEmailRequest,
  postSchoolEmailVerify,
  postStudentCard,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const INPUT_CLS =
  "w-full rounded-xl border border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.05)] px-4 py-3 text-[13.5px] text-moss-100 outline-none placeholder:text-moss-700 focus:border-[rgba(143,220,138,.45)]";
const PRIMARY_BTN =
  "w-full rounded-xl border border-bean-400 bg-bean-500 p-3 text-sm font-bold text-[#f0f7ec] shadow-[0_6px_24px_rgba(63,143,71,.35)] transition-colors hover:bg-[#4aa353] disabled:opacity-60";

type Method = "school_email" | "student_card";

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
      <div className="flex h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)]">
        <p className="animate-pulse text-sm text-moss-600">확인 중…</p>
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
      <div className="text-[42px]">🌳</div>
      <h2 className="mt-3 font-serif text-[20px] font-bold text-moss-100">
        연세대 학부생 인증 완료!
      </h2>
      <p className="mt-2 text-[12.5px] text-moss-500">
        {me.verification_method === "student_card"
          ? "학생증 심사가 승인됐어요."
          : "학교 이메일로 인증됐어요."}{" "}
        이제 씨앗을 심고 콩나무를 키울 수 있어요.
      </p>
      <div className="mt-6 flex gap-2">
        <Link
          href="/new"
          className="flex-1 rounded-xl border border-bean-400 bg-bean-500 p-3 text-center text-sm font-bold !text-[#f0f7ec] no-underline transition-colors hover:bg-[#4aa353]"
        >
          새 씨앗 심기
        </Link>
        <Link
          href="/"
          className="flex-1 rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] p-3 text-center text-sm font-semibold !text-bean-100 no-underline transition-colors hover:bg-[rgba(143,220,138,.25)]"
        >
          숲 구경하기
        </Link>
      </div>
    </div>
  ) : me.card_status === "pending" ? (
    <div className="text-center">
      <div className="text-[42px]">🕰️</div>
      <h2 className="mt-3 font-serif text-[20px] font-bold text-moss-100">학생증 심사 중</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-moss-500">
        운영자가 확인하는 대로 알려드릴게요 (보통 24시간 이내).
        <br />
        심사가 끝나면 이미지는 즉시 파기돼요. 그동안 숲 구경은 자유예요!
      </p>
      <Link
        href="/"
        className="mt-6 block w-full rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] p-3 text-center text-sm font-semibold !text-bean-100 no-underline transition-colors hover:bg-[rgba(143,220,138,.25)]"
      >
        숲 구경하기
      </Link>
    </div>
  ) : (
    <>
      {me.card_status === "rejected" && (
        <p className="mb-4 rounded-xl border border-[rgba(196,154,90,.3)] bg-[rgba(196,154,90,.12)] p-3 text-[12px] leading-relaxed text-wither-300">
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
          <button
            key={value}
            type="button"
            onClick={() => {
              setMethod(value);
              setError(null);
              setNotice(null);
            }}
            className={`flex-1 rounded-full border px-4 py-2 text-[12.5px] font-semibold transition-colors ${
              method === value
                ? "border-[rgba(143,220,138,.4)] bg-[rgba(143,220,138,.16)] text-moss-300"
                : "border-[rgba(143,220,138,.18)] text-moss-500 hover:bg-[rgba(143,220,138,.08)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {method === "school_email" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={requestCode} className="flex gap-2">
            <input
              type="email"
              value={schoolEmail}
              onChange={(e) => setSchoolEmail(e.target.value)}
              placeholder="학번@yonsei.ac.kr"
              className={INPUT_CLS}
            />
            <button
              type="submit"
              disabled={pending || !schoolEmail.trim()}
              className="shrink-0 rounded-xl border border-[rgba(143,220,138,.28)] bg-[rgba(143,220,138,.13)] px-4 text-[12.5px] font-semibold text-bean-100 transition-colors hover:bg-[rgba(143,220,138,.25)] disabled:opacity-50"
            >
              {codeSent ? "재발송" : "코드 받기"}
            </button>
          </form>
          {codeSent && (
            <form onSubmit={verifyCode} className="flex flex-col gap-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="인증 코드 6자리"
                inputMode="numeric"
                className={`${INPUT_CLS} text-center text-[18px] tracking-[.4em]`}
              />
              <button type="submit" disabled={pending || code.length !== 6} className={PRIMARY_BTN}>
                {pending ? "확인 중…" : "인증하기"}
              </button>
            </form>
          )}
        </div>
      ) : (
        <form onSubmit={uploadCard} className="flex flex-col gap-3">
          <p className="text-[12px] leading-relaxed text-moss-500">
            모바일 학생증 캡처 또는 실물 학생증 사진(JPEG/PNG, 5MB 이하)을 올려주세요. 운영자
            확인 후 <b className="text-moss-300">이미지는 즉시 파기</b>되고 승인 여부만 남아요.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="text-[12.5px] text-moss-400 file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-[rgba(143,220,138,.28)] file:bg-[rgba(143,220,138,.13)] file:px-4 file:py-2 file:text-[12px] file:font-semibold file:text-bean-100"
          />
          <button type="submit" disabled={pending} className={PRIMARY_BTN}>
            {pending ? "올리는 중…" : "학생증 제출하기"}
          </button>
        </form>
      )}
      {notice && !error && <p className="mt-3 text-[12.5px] text-bean-200">{notice}</p>}
      {error && <p className="mt-3 text-[12.5px] text-wither-300">{error}</p>}
    </>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)] px-4 py-16">
      <div className="w-full max-w-[440px] rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] p-8 shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[10px]">
        {!me.yonsei_verified && me.card_status !== "pending" && (
          <>
            <h1 className="font-serif text-[26px] font-bold text-moss-100">연세대 학부생 인증</h1>
            <p className="mb-6 mt-[7px] text-[12.5px] leading-relaxed text-moss-600">
              콩나무를 심고 키우려면 인증이 필요해요. 둘 중 편한 방법을 골라주세요.
            </p>
          </>
        )}
        {body}
      </div>
    </div>
  );
}
