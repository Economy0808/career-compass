"use client";

/*
 * 이메일/학부생 인증 - login·signup과 같은 세계에 놓인 화면.
 * 사용자 지시: 서비스 이용 전 부대 작업(로그인·회원가입·이메일 인증 등)은 모두
 * 랜딩페이지와 같은 테마의 페이지에서 진행해야 한다 - 다크월드 앱 셸(SideRail
 * 포함) 안이 아니라 login/page.tsx와 동일한 밝은 종이 오버레이여야 한다.
 * 로직(폴링·재발송 쿨다운·라우팅 가드)은 손대지 않았다, 마크업/클래스만 바뀌었다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { cn } from "@/lib/cn";
import { getFirebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

/** 오류 문구용 잉크 섞은 붉은색 - login/page.tsx와 같은 이유(밝은 종이 위에서
 * spec-m 원색은 대비가 모자란다). 새 hex를 만들지 않고 팔레트 안에서 섞어 쓴다. */
const PAPER_DANGER = "color-mix(in srgb, var(--spec-m) 55%, var(--paper-ink))";

const BUTTON_PRIMARY =
  "cta-ink inline-flex w-full items-center justify-center gap-2 rounded-md bg-paper-ink px-5 py-2.5 text-body-sm font-semibold text-paper transition-[filter,background-color] duration-150 disabled:pointer-events-none disabled:opacity-50";
const BUTTON_SECONDARY =
  "inline-flex w-full items-center justify-center gap-2 rounded-sm border border-paper-line bg-paper-soft px-3.5 py-1.5 text-caption font-semibold text-paper-ink transition-colors hover:bg-paper-line/50 disabled:pointer-events-none disabled:opacity-50";
const LINK_PRIMARY =
  "flex-1 rounded-md border border-transparent bg-paper-ink p-3 text-center text-body-sm font-bold text-paper no-underline";
const LINK_SECONDARY =
  "rounded-md border border-paper-line bg-paper-soft p-3 text-center text-body-sm font-semibold text-paper-ink no-underline transition-colors hover:bg-paper-line/50";

const RESEND_COOLDOWN_SECONDS = 30;
const POLL_INTERVAL_MS = 5000;

/** 성도 인쇄물의 외곽 계선 + 오버레이 - login/page.tsx와 동일한 판형. 로딩
 * 상태(이른 return)와 본문 상태 둘 다 이 틀 안에서 렌더된다. */
function PaperFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="paper-surface bg-paper-grid fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden"
      style={{ backgroundColor: "var(--paper)", color: "var(--paper-ink)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-4 border md:inset-7"
        style={{ borderColor: "var(--paper-line)" }}
      />
      <header className="absolute inset-x-4 top-4 z-10 flex items-center justify-between px-6 py-5 md:inset-x-7 md:top-7 md:px-9">
        <Link
          href="/"
          className="font-serif text-title font-bold tracking-wide no-underline"
          style={{ color: "var(--paper-ink)" }}
        >
          OurLab
        </Link>
        <Link href="/demo" className="text-body-sm" style={{ color: "var(--paper-lo)" }}>
          둘러보기
        </Link>
      </header>
      <div className="flex min-h-full items-center justify-center px-6 py-24">
        <div className="w-full max-w-[420px] rounded-lg border border-paper-line bg-paper p-8">{children}</div>
      </div>
    </div>
  );
}

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
      <PaperFrame>
        <p className="animate-pulse text-center text-body-sm text-paper-lo">확인 중…</p>
      </PaperFrame>
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
      <h2 className="mt-3 font-serif text-title font-bold text-paper-ink">이메일 인증이 필요해요</h2>
      <p className="mt-2 text-body-sm leading-relaxed text-paper-lo">
        <b className="text-paper-ink">{user.email}</b>로 인증 메일을 보냈어요.
        <br />
        메일함의 링크를 눌러 인증을 완료해주세요.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" disabled={pending} onClick={checkVerified} className={BUTTON_PRIMARY}>
          {pending ? "확인 중…" : "인증 완료했어요"}
        </button>
        <button
          type="button"
          disabled={pending || resendCooldown > 0}
          onClick={resendEmail}
          className={BUTTON_SECONDARY}
        >
          {resendCooldown > 0 ? `재발송 (${resendCooldown}초 후 가능)` : "인증 메일 다시 보내기"}
        </button>
      </div>
      {notice && !error && <p className="mt-3 text-caption text-paper-ink">{notice}</p>}
      {error && (
        <p className="mt-3 text-caption" style={{ color: PAPER_DANGER }}>
          {error}
        </p>
      )}
    </div>
  ) : user.yonseiVerified ? (
    <div className="text-center">
      <div className="text-5xl">✨</div>
      <h2 className="mt-3 font-serif text-title font-bold text-paper-ink">
        연세대 학부생 인증 완료!
      </h2>
      <p className="mt-2 text-body-sm text-paper-lo">
        학교 이메일로 인증됐어요. 이제 나만의 별자리를 만들 수 있어요.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/constellation/new" className={LINK_PRIMARY}>
          별자리 생성하기
        </Link>
        {/* 인증을 마친 사용자의 "둘러보기"는 랜딩이 아니라 메인 캔버스다
            (사용자 지시 2026-09-03: "이메일인증하고 둘러보기 누르면 메인
            캔버스로 이동해야지"). 비로그인 체험(/demo)과는 다른 동선. */}
        <Link href="/constellation/new" className={cn(LINK_SECONDARY, "flex-1")}>
          둘러보기
        </Link>
      </div>
    </div>
  ) : (
    <div className="text-center">
      <div className="text-5xl">🎓</div>
      <h2 className="mt-3 font-serif text-title font-bold text-paper-ink">연세대 학부생 인증</h2>
      <p className="mt-2 text-body-sm leading-relaxed text-paper-lo">
        학번@yonsei.ac.kr 메일로 가입하면 자동으로 인증돼요.
        <br />
        학생증 인증은 아직 준비 중이에요.
      </p>
      <button
        type="button"
        disabled
        className={cn(
          "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md border border-paper-line bg-paper-soft px-5 py-2.5 text-body-sm font-semibold text-paper-ink",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
      >
        학생증 인증 (준비 중)
      </button>
      {/* 로그인+미인증도 캔버스 열람은 사양(3계층: 미인증=열람) - 랜딩으로
          보내면 갈 곳이 없다. 위 인증 완료 상태와 같은 동선. */}
      <Link href="/constellation/new" className={cn(LINK_SECONDARY, "mt-3 block w-full")}>
        둘러보기
      </Link>
    </div>
  );

  return <PaperFrame>{body}</PaperFrame>;
}
