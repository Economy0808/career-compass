"use client";

/**
 * 회원 탈퇴 확인 모달 - 예전 "위험 구역" 카드에서 모달만 남긴 것(사용자 지시:
 * 위험 구역 카드를 없애고 프로필 케밥 메뉴의 항목으로 이동).
 *
 * 데모 배포는 Postgres를 붙이지 않아 구 세션 인증(app/api/auth.py)의 탈퇴
 * 엔드포인트가 없다(사용자 지시: "A안" - 인증 신청 기능을 빼고 미리 인증해둔
 * 심사용 계정으로 보여준다). 실제 삭제 대신 정직한 안내만 보여준다.
 */

import { Button, Modal } from "@/components/ui";

export interface AccountDeleteModalProps {
  open: boolean;
  onClose: () => void;
  /** 탈퇴가 끝나고 로그아웃까지 마친 뒤 호출된다. 데모에서는 쓰이지 않는다. */
  onDeleted: () => void;
}

export function AccountDeleteModal({ open, onClose }: AccountDeleteModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="회원 탈퇴" size="sm">
      <p className="text-body-sm leading-relaxed text-text-lo">
        데모 환경에서는 회원 탈퇴가 비활성화되어 있어요. 미리 인증된 데모 계정을
        둘러보는 용도로만 사용해주세요.
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          확인
        </Button>
      </div>
    </Modal>
  );
}
