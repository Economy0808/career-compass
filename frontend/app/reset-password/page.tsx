"use client";

import Link from "next/link";
import { Card } from "@/components/ui";

// 데모 배포는 Postgres를 붙이지 않아 구 세션 인증(app/api/auth.py)의 비밀번호
// 재설정 엔드포인트가 없다(사용자 지시: "A안" - 인증 신청 기능을 빼고 미리
// 인증해둔 심사용 계정으로 보여준다). 깨진 폼 대신 정직한 안내만 보여준다.
export default function ResetPasswordPage() {
  return (
    <div className="mx-auto flex min-h-[76dvh] w-full max-w-md flex-col justify-center">
      <Card className="p-8 text-center">
        <h1 className="font-serif text-display font-bold text-text-hi">비밀번호 재설정</h1>
        <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-text-lo">
          데모 환경에서는 비밀번호 재설정이 비활성화되어 있어요.
          <br />
          미리 인증된 데모 계정으로 로그인해서 둘러봐 주세요.
        </p>
        <Link href="/login" className="font-semibold text-spec-b">
          로그인으로 돌아가기
        </Link>
      </Card>
    </div>
  );
}
