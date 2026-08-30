"use client";

/*
 * 연세대 인증 유도 안내 - 미인증 상태(user는 있지만 yonseiVerified=false)에서
 * 쓰기 액션을 시도했을 때 화면마다 복붙하지 않도록 공용으로 묶는다.
 *
 * 비로그인 유도("로그인하세요")와 문구가 섞이면 안 된다는 게 이 과제의 핵심
 * 지시라 별도 컴포넌트로 분리했다 - 비로그인 분기는 화면마다 기존 로그인 유도를
 * 그대로 쓰고, 이건 "로그인은 했지만 아직 인증 전"인 사용자 전용이다.
 *
 * 서버 403 + X-Auth-Requirement: yonsei-verified 응답을 받았을 때(최후 방어선)
 * 뿐 아니라, useAuth().user.yonseiVerified가 false면 서버까지 가기 전에도
 * 선제적으로 띄운다(호출부 책임 - 이 컴포넌트는 열림 상태만 받는다).
 */

import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/ui";

export interface VerifyGateProps {
  open: boolean;
  onClose: () => void;
}

export function VerifyGate({ open, onClose }: VerifyGateProps) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title="연세대 학부생 인증이 필요해요" size="sm">
      <p className="text-body-sm text-text-lo">
        재학 인증을 마치면 글쓰기·댓글·팔로우를 쓸 수 있어요
      </p>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => router.push("/verify")}>
          인증하기
        </Button>
        <Button variant="ghost" onClick={onClose}>
          나중에
        </Button>
      </div>
    </Modal>
  );
}

/** 403+X-Auth-Requirement 판정 - 호출부가 catch 블록에서 이 조건 하나로 분기한다. */
export function isVerifyRequiredError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 403 &&
    (err as { authRequirement?: unknown }).authRequirement === "yonsei-verified"
  );
}
