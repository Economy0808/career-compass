"use client";

/**
 * 회원 탈퇴 확인 모달 - 예전 "위험 구역" 카드에서 모달만 남긴 것(사용자 지시:
 * 위험 구역 카드를 없애고 프로필 케밥 메뉴의 항목으로 이동). 여는 쪽(케밥
 * 메뉴)이 open 상태를 소유한다.
 */

import { useEffect, useState } from "react";
import { Button, Field, Modal } from "@/components/ui";
import { ApiError, deleteAccount } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export interface AccountDeleteModalProps {
  open: boolean;
  onClose: () => void;
  /** 탈퇴가 끝나고 로그아웃까지 마친 뒤 호출된다. */
  onDeleted: () => void;
}

export function AccountDeleteModal({ open, onClose, onDeleted }: AccountDeleteModalProps) {
  const { logout } = useAuth();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때마다 초기화 - 이전 시도의 비밀번호/에러가 남지 않게.
  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function confirm() {
    if (pending || !password) return;
    setPending(true);
    setError(null);
    try {
      await deleteAccount(password);
      await logout();
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "탈퇴에 실패했어요.");
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !pending && onClose()} title="회원 탈퇴" size="sm">
      <p className="text-body-sm leading-relaxed text-text-lo">
        계정과 모든 데이터(별자리·기록·일정)가{" "}
        <b className="text-text-hi">영구 삭제</b>되고 되돌릴 수 없어요. 계속하려면
        비밀번호를 입력해주세요.
      </p>
      <Field
        id="danger-password"
        label="비밀번호"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="mt-4"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        error={error}
      />
      <div className="mt-5 flex gap-2">
        <Button
          variant="danger"
          className="flex-1"
          onClick={confirm}
          disabled={pending || !password}
        >
          {pending ? "탈퇴 중…" : "영구 탈퇴하기"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          취소
        </Button>
      </div>
    </Modal>
  );
}
