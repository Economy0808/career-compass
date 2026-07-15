"use client";

import { useState } from "react";

// 할 일 앞의 콩 모양 완료 버튼. 미완료=빈 외곽선, 완료=채워진 콩 + pop 애니메이션.
const BEAN_PATH =
  "M8 4.5C4.8 6.2 4 11 6.6 14.8c2.7 3.9 8 5.6 11.6 3.9 3.3-1.6 4-6.4 1.4-10.2C17 4.6 11.3 2.8 8 4.5Z";

interface BeanCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function BeanCheckbox({ checked, onToggle, disabled, ariaLabel }: BeanCheckboxProps) {
  const [popping, setPopping] = useState(false);

  function handleClick() {
    if (disabled) return;
    if (!checked) {
      setPopping(true);
      setTimeout(() => setPopping(false), 520);
    }
    onToggle();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={ariaLabel ?? (checked ? "완료 취소" : "완료로 표시")}
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:cursor-default"
    >
      <svg width="22" height="22" viewBox="0 0 24 24">
        {/* 외곽선 (항상) */}
        <path
          d={BEAN_PATH}
          fill="none"
          stroke={checked ? "#5db35b" : "#5e7d63"}
          strokeWidth={2}
        />
        {/* 채워진 콩 (완료 시) */}
        {checked && (
          <g
            style={
              popping
                ? {
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: "sprout .5s cubic-bezier(.34,1.56,.64,1) both",
                  }
                : undefined
            }
          >
            <path d={BEAN_PATH} fill="#3f8f47" />
            <path
              d="M10 8c1.4 1 3.8 3 4.8 5.4"
              fill="none"
              stroke="#8fdc8a"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>
    </button>
  );
}
