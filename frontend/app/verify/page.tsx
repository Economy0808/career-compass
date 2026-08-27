"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getFirebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

const LINK_PRIMARY =
  "flex-1 rounded-md border border-transparent bg-spec-b p-3 text-center text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110";
const LINK_SECONDARY =
  "rounded-md border border-rule bg-spec-b/12 p-3 text-center text-body-sm font-semibold text-spec-b no-underline transition-colors hover:bg-spec-b/20";

const RESEND_COOLDOWN_SECONDS = 30;
const POLL_INTERVAL_MS = 5000;

export default function VerifyPage() {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  // 이메일 인증 대기 중에는 5초마다 자동으로 상태를 다시 확인한다 —
  // 사용자가 메일함에서 링크를 누르고 돌아오면 버튼을 누르지 않아도 화면이 바뀐다.
  useEffect(() => {
    if (loading || !user || user.emailVerified) return;

    const interval = setInterval(async () => {
      try {
        await getFirebaseAuth().currentUser?.reload();
        if (getFirebaseAuth().currentUser?.emailVerified) {
          await getFirebaseAuth().currentUser?.getIdToken(true);
          await refresh();
        }
      } catch {
        // 폴링 실패는 조용히 무시한다 — 다음 주기에 다시 시도한다.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [loading, user, refresh]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  if (loading || !user) {
    return (
      <div className="mx-auto w-full max-w-md py-16 text-center">
        <p className="animate-pulse text-body-sm text-text-lo">확인 중…</p>
      </div>
    );
  }

  async function resendEmail() {
    if (pending || resendCooldown > 0) return;
    const fbUser = getFirebaseAuth().currentUser;
    if (!fbUser) return;
    setPending(true);
    setError(null);
    try {
      await sendEmailVerification(fbUser);
      setNotice("인증 메일을 다시 보냈어요. 메일함을 확인해 주세요.");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError("메일 재발송에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  async function checkVerified() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await getFirebaseAuth().currentUser?.reload();
      if (getFirebaseAuth().currentUser?.emailVerified) {
        await getFirebaseAuth().currentUser?.getIdToken(true);
        await refresh();
      } else {
        setNotice(null);
        setError("아직 인증이 확인되지 않았어요. 메일함의 링크를 눌러주세요.");
      }
    } catch {
      setError("확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  const body = !user.emailVerified ? (
    <div className="text-center">
      <div className="text-5xl">📧</div>
      <h2 className="mt-3 font-serif text-title font-bold text-text-hi">이메일 인증이 필요해요</h2>
      <p className="mt-2 text-body-sm leading-relaxed text-text-lo">
        <b className="text-text-hi">{user.email}</b>로 인증 메일을 보냈어요.
        <br />
        메일함의 링크를 눌러 인증을 완료해주세요.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button type="button" variant="primary" size="md" fullWidth disabled={pending} onClick={checkVerified}>
          {pending ? "확인 중…" : "인증 완료했어요"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          fullWidth
          disabled={pending || resendCooldown > 0}
          onClick={resendEmail}
        >
          {resendCooldown > 0 ? `재발송 (${resendCooldown}초 후 가능)` : "인증 메일 다시 보내기"}
        </Button>
      </div>
      {notice && !error && <p className="mt-3 text-caption text-lit">{notice}</p>}
      {error && <p className="mt-3 text-caption text-spec-m">{error}</p>}
    </div>
  ) : user.yonseiVerified ? (
    <div className="text-center">
      <div className="text-5xl">✨</div>
      <h2 className="mt-3 font-serif text-title font-bold text-text-hi">
        연세대 학부생 인증 완료!
      </h2>
      <p className="mt-2 text-body-sm text-text-lo">
        학교 이메일로 인증됐어요. 이제 나만의 별자리를 만들 수 있어요.
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
  ) : (
    <div className="text-center">
      <div className="text-5xl">🎓</div>
      <h2 className="mt-3 font-serif text-title font-bold text-text-hi">연세대 학부생 인증</h2>
      <p className="mt-2 text-body-sm leading-relaxed text-text-lo">
        학번@yonsei.ac.kr 메일로 가입하면 자동으로 인증돼요.
        <br />
        학생증 인증은 아직 준비 중이에요.
      </p>
      <Button type="button" variant="secondary" size="md" fullWidth disabled className="mt-6">
        학생증 인증 (준비 중)
      </Button>
      <Link href="/" className={cn(LINK_SECONDARY, "mt-3 block w-full")}>
        둘러보기
      </Link>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="p-8">{body}</Card>
    </div>
  );
}
