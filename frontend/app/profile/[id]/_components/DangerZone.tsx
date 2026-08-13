"use client";

import { useState } from "react";
import { Button, Field, Modal } from "@/components/ui";
import { ApiError, deleteAccount } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export interface DangerZoneProps {
  /** 탈퇴가 끝나고 로그아웃까지 마친 뒤 호출된다. */
  onDeleted: () => void;
}

export function DangerZone({ onDeleted }: DangerZoneProps) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="mt-14 rounded-lg border border-wither/30 bg-wither/8 p-5">
      <h2 className="text-body-sm font-bold text-wither">위험 구역</h2>
      <p className="mt-1.5 text-caption leading-relaxed text-content-muted">
        회원 탈퇴 시 계정과 모든 콩나무·기록·투두가 영구 삭제되며 되돌릴 수 없어요.
      </p>
      <Button
        variant="danger"
        size="sm"
        className="mt-3"
        onClick={() => {
          setPassword("");
          setError(null);
          setOpen(true);
        }}
      >
        회원 탈퇴
      </Button>

      <Modal open={open} onClose={() => !pending && setOpen(false)} title="회원 탈퇴" size="sm">
        <p className="text-body-sm leading-relaxed text-content-secondary">
          계정과 모든 데이터(콩나무·기록·투두·콩)가{" "}
          <b className="text-content-primary">영구 삭제</b>되고 되돌릴 수 없어요. 계속하려면
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
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            취소
          </Button>
        </div>
      </Modal>
    </div>
  );
}
