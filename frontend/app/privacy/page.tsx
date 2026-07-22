export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0a1f11,#06120a_55%)]">
      {/* SideNav(fixed)를 비켜서 정렬 — /new와 동일 클램프. */}
      <div className="ml-[max(206px,calc((100vw-640px)/2))] mr-auto w-[640px] max-w-[calc(100vw-226px)] py-[88px]">
        <h1 className="font-serif text-[30px] font-bold text-moss-100">개인정보 처리방침</h1>
        <p className="mt-2 text-[12px] text-moss-700">초안 — 정식 오픈 전 법률 검토 예정</p>

        <div className="mt-8 flex flex-col gap-6 text-[13px] leading-[1.8] text-moss-400">
          <section>
            <h2 className="mb-1.5 text-[15px] font-bold text-moss-100">1. 수집하는 개인정보</h2>
            <p>
              필수: 아이디, 비밀번호(Argon2id 해시로만 저장), 이메일, 닉네임. 선택: 연세대 재학
              확인을 위한 학생증 이미지 또는 학교 이메일 주소.
            </p>
          </section>
          <section>
            <h2 className="mb-1.5 text-[15px] font-bold text-moss-100">2. 이용 목적</h2>
            <p>
              회원 식별과 로그인, 연세대 학부생 재학 확인, 서비스 내 활동(로드맵·팔로우) 표시.
              수집한 정보는 이 목적 밖으로 사용하지 않으며 외부에 제공하지 않아요.
            </p>
          </section>
          <section>
            <h2 className="mb-1.5 text-[15px] font-bold text-moss-100">3. 보유 및 파기</h2>
            <p>
              학생증 이미지는 심사(승인/반려) 즉시 파일을 파기하고 심사 결과만 보관해요. 인증
              코드는 10분 뒤 만료되며, 로그인 세션은 최대 14일 보관돼요. 회원 탈퇴 시 계정
              정보는 지체 없이 삭제돼요.
            </p>
          </section>
          <section>
            <h2 className="mb-1.5 text-[15px] font-bold text-moss-100">4. 문의</h2>
            <p>개인정보 관련 문의는 운영자 이메일로 연락해주세요.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
