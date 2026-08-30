"use client";

/*
 * 미인증 쓰기 액션 공용 가드 - 화면마다 반복되는 "선제 차단(1차) + 403
 * 최후 방어선(2차)" 두 줄을 훅으로 묶는다. VerifyGate.tsx 자체는 과제
 * 지시상 수정 금지라 그 컴포넌트/판정 함수를 그대로 재사용만 한다.
 *
 * 쓰기 지점이 많은 화면(예: 일정 - 토글/추가/삭제/분류 CRUD)에서만 쓴다.
 * 이미 인라인으로 verifyGateOpen state를 갖고 있는 기존 화면은 건드리지
 * 않는다(과제 지시: "이미 붙은 곳은 유지").
 */

import { useCallback, useState } from "react";
import { isVerifyRequiredError } from "@/components/VerifyGate";
import type { AuthUser } from "@/lib/types";

export function useVerifyGuard() {
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);

  /** 1차 방어선 - 서버에 가기 전에 막는다. 진행 가능하면 true. */
  const guardWrite = useCallback((user: AuthUser | null): boolean => {
    if (user && !user.yonseiVerified) {
      setVerifyGateOpen(true);
      return false;
    }
    return true;
  }, []);

  /** 2차 방어선 - catch 블록에서 호출. 인증 필요 에러면 게이트를 띄우고
   * true를 반환한다(호출부는 그 자리에서 return해 일반 에러 처리를 건너뛴다). */
  const handleWriteError = useCallback((err: unknown): boolean => {
    if (isVerifyRequiredError(err)) {
      setVerifyGateOpen(true);
      return true;
    }
    return false;
  }, []);

  return {
    verifyGateOpen,
    closeVerifyGate: () => setVerifyGateOpen(false),
    guardWrite,
    handleWriteError,
  };
}
