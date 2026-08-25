export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-md py-16">
      <h1 className="font-serif text-display font-bold text-content-primary">개인정보 처리방침</h1>
      <p className="mt-2 text-caption text-content-muted">초안 — 정식 오픈 전 법률 검토 예정</p>

      <div className="mt-8 flex flex-col gap-6 text-body-sm leading-relaxed text-content-secondary">
        <section>
          <h2 className="mb-1.5 text-body font-bold text-content-primary">1. 수집하는 개인정보</h2>
          <p>
            필수: 아이디, 비밀번호(Argon2id 해시로만 저장), 이메일, 닉네임. 선택: 연세대 재학
            확인을 위한 학생증 이미지 또는 학교 이메일 주소.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-body font-bold text-content-primary">2. 이용 목적</h2>
          <p>
            회원 식별과 로그인, 연세대 학부생 재학 확인, 서비스 내 활동(로드맵·팔로우) 표시.
            수집한 정보는 이 목적 밖으로 사용하지 않으며 외부에 제공하지 않아요.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-body font-bold text-content-primary">3. 보유 및 파기</h2>
          <p>
            학생증 이미지는 심사(승인/반려) 즉시 파일을 파기하고 심사 결과만 보관해요. 인증
            코드는 10분 뒤 만료되며, 로그인 세션은 최대 14일 보관돼요. 회원 탈퇴 시 계정
            정보는 지체 없이 삭제돼요.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-body font-bold text-content-primary">4. 문의</h2>
          <p>개인정보 관련 문의는 운영자 이메일로 연락해주세요.</p>
        </section>
      </div>
    </div>
  );
}
