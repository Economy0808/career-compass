"use client";

/**
 * 종이 세계(랜딩·로그인·가입·온보딩) 공용 폼 요소. 다크월드용 Field(19개 파일이
 * 공유)와 달리 밝은 종이 재질로 그린다 - 사용자 지시("서비스 이용 전 부대 작업은
 * 랜딩과 같은 테마")대로 login/signup/onboarding이 같은 재질을 쓴다. focus-visible
 * 아웃라인 레시피는 design-handoff 가이드 §3 정본 표기를 따른다.
 *
 * 가입(app/signup)과 온보딩(app/onboarding) 두 곳이 쓰기 시작해 여기로 뺐다
 * (이전엔 signup/page.tsx 안에 있었다).
 */
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const FIELD =
  "w-full rounded-md border border-paper-line bg-paper px-3.5 py-2.5 font-sans text-body text-paper-ink placeholder:text-paper-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink";
const LABEL = "text-caption font-semibold text-paper-lo";

export function PaperField({
  id,
  label,
  ...rest
}: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input id={id} className={FIELD} {...rest} />
    </div>
  );
}

export function PaperSelect({
  id,
  label,
  ...rest
}: { id: string; label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select id={id} className={FIELD} {...rest} />
    </div>
  );
}

export function PaperTextarea({
  id,
  label,
  ...rest
}: { id: string; label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea id={id} className={`${FIELD} resize-none`} {...rest} />
    </div>
  );
}
