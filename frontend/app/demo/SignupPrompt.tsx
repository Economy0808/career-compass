"use client";

/*
 * 둘러보기(데모) 전용 가입 유도 모달 - 저장/발행처럼 영속이 필요한 행동을
 * 시도했을 때만 띄운다(사용자 지시: "과하게 자주 막지 말 것 - 체험이
 * 목적이다"). app/demo/** 3개 탭이 공유하는 유일한 로컬 컴포넌트.
 */

import { Modal, Button } from "@/components/ui";

export interface SignupPromptProps {
  open: boolean;
  onClose: () => void;
  /** 무엇을 하려다 막혔는지 - 모달 문구에 그대로 들어간다. */
  action: string;
}

export function SignupPrompt({ open, onClose, action }: SignupPromptProps) {
  return (
    <Modal open={open} onClose={onClose} title="가입하고 계속하기" size="sm">
      <p className="text-body-sm text-text-lo">
        둘러보기 모드에서는 {action}이(가) 저장되지 않아요. 가입하면 지금 만든 걸 그대로 이어서 쓸 수 있어요.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          계속 둘러보기
        </Button>
        <Button variant="primary" size="sm" onClick={() => (window.location.href = "/signup")}>
          가입하고 시작하기
        </Button>
      </div>
    </Modal>
  );
}
