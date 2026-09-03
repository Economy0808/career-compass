"use client";

import Link from "next/link";

// 데모 배포는 Postgres를 붙이지 않아 구 세션 인증(app/api/auth.py)의 비밀번호
// 재설정 엔드포인트가 없다(사용자 지시: "A안" - 인증 신청 기능을 빼고 미리
// 인증해둔 심사용 계정으로 보여준다). 깨진 폼 대신 정직한 안내만 보여준다.
//
// 사용자 지시: 서비스 이용 전 부대 작업(로그인·회원가입·이메일 인증 등)은 모두
// 랜딩페이지와 같은 테마의 페이지에서 진행해야 한다 - login/page.tsx와 동일한
// 밝은 종이 오버레이로, 다크월드 앱 셸(SideRail 포함) 밖에서 렌더한다.
export default function ResetPasswordPage() {
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
        <div className="w-full max-w-[420px] rounded-lg border border-paper-line bg-paper p-8 text-center">
          <h1 className="font-serif text-display font-bold text-paper-ink">비밀번호 재설정</h1>
          <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-paper-lo">
            데모 환경에서는 비밀번호 재설정이 비활성화되어 있어요.
            <br />
            미리 인증된 데모 계정으로 로그인해서 둘러봐 주세요.
          </p>
          <Link href="/login" className="font-semibold text-paper-ink">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
