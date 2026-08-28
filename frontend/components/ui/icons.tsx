import type { CSSProperties, ReactNode } from "react";

type IconProps = { size?: number; className?: string; style?: CSSProperties };

function svg(size: number, className: string | undefined, style: CSSProperties | undefined, children: ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      {children}
    </svg>
  );
}

export function SproutIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <path d="M12 22V10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12.5C12 9 9 7 5 7C5 10.5 8 12.5 12 12.5Z" fill="currentColor" />
      <path d="M12 10C12 7 14.5 5 18 5C18 8.5 15.5 10 12 10Z" fill="currentColor" />
    </>
  ));
}

/** 프로필 마크 - 원 안의 사람 실루엣(인스타그램 프로필 탭 관례). 네비의
 * "내 별자리"를 대체한다(사용자 지시). */
export function ProfileIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="transparent" />
      <circle cx="12" cy="10" r="3" fill="currentColor" />
      <path d="M6.5 18.2c1-2.6 3.1-3.9 5.5-3.9s4.5 1.3 5.5 3.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="transparent" />
    </>
  ));
}

export function SeedIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function CalendarIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

/** Replaces the target emoji used for career goals. */
export function TargetIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>
  ));
}

export function KeyIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12h9M18 12v3.5M15.5 12v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function CheckIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />);
}

export function CloseIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />);
}

export function ChevronRightIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />);
}

export function ChevronLeftIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />);
}

/** 돋보기 - 탐색 탭 전용(사용자 지시: "돋보기 아이콘으로 바꾸고 탐색으로"). */
export function SearchIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" fill="transparent" />
      <path d="M15.5 15.5 20.5 20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

/** 게시판 목록 아이콘 - 말풍선 안에 목록 줄(커뮤니티 네비 전용). */
export function BoardIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <path
        d="M4 5.5h16v10H9.5L5.5 19V15.5H4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="transparent"
      />
      <path d="M7.5 9h9M7.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ));
}

/** 서랍장(보관함) 아이콘 - 몰입형 캔버스의 네비 섬 토글 버튼 전용. */
export function DrawerIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 7.5h5M9.5 16.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function PlusIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />);
}

export function InfoIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.75" r="1.1" fill="currentColor" />
    </>
  ));
}

/**
 * Eagle silhouette. A motif nod to the university symbol, deliberately
 * generic: never the official crest or wordmark (trademark).
 * Used only in the night sky and at completion moments.
 */
export function EagleIcon({ size = 18, className, style }: IconProps) {
  return svg(size, className, style, (
    <path
      d="M2 9c3.2-.4 5.4.7 7 2.4V9.6c0-1 .8-1.9 1.9-1.9h2.2c1 0 1.9.8 1.9 1.9v1.8C16.6 9.7 18.8 8.6 22 9c-2.1 2.2-3.6 3.9-5.7 5.1-1.4.8-2.9 1.2-4.3 1.2s-2.9-.4-4.3-1.2C5.6 12.9 4.1 11.2 2 9Z"
      fill="currentColor"
    />
  ));
}
