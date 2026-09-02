"use client";

/**
 * 편집 모드에서 선택한 노드의 색을 바꾸는 직사각형 팔레트 바.
 *
 * 하단 중앙에 뜨는 종이 섬(islandExpand 재사용) - 스와치는 DESIGN.md에 이미
 * 고정된 토큰 hex만 쓴다(새 hex 금지). 여기서 고른 색은 그대로
 * NodeDto.color(#RRGGBB) 문자열로 서버에 저장되므로 CSS 변수 참조가 아니라
 * 실제 hex 값을 다룬다.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "@/components/ui/icons";
import { GLOW_PRESETS } from "@/components/ConstellationCanvas";
import { TYPE_DEFAULT_HEX } from "@/lib/element-colors";

// EyeDropper API(크로미움 전용) - TS lib.dom에 아직 없어 최소 선언만 둔다.
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

export interface ColorSwatchTarget {
  id: string;
  label: string;
  type: string;
  color?: string;
}

// 분광형 토큰 5색 - "기본 추천값"으로 유지한다(별상 전환으로 색이 자유
// RGB가 됐지만, 유형 기본색과 그 시각 계보는 남긴다). 값은 globals.css
// --spec-* 실값과 동일.
const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#9DB4FF", name: "항성청" },
  { hex: "#E8ECFF", name: "자격증" },
  { hex: "#FFD98A", name: "학회" },
  { hex: "#FFA76B", name: "대외활동" },
  { hex: "#FF7B72", name: "네트워킹" },
  { hex: "#FFF3C4", name: "별빛" },
  { hex: "#E8EAF2", name: "본문" },
];

// 별상 시안 Rev.B의 12색 자유 팔레트 - 위 기본 추천과 겹치는 두 색(별빛
// #FFF3C4, 본문 #E8EAF2)은 뺐다(같은 스와치가 두 번 뜨면 "왜 두 개냐"가 된다).
const FREE_SWATCHES: { hex: string; name: string }[] = [
  { hex: "#FF5D5D", name: "진홍" },
  { hex: "#FF9D4D", name: "주황" },
  { hex: "#FFD9A0", name: "살구" },
  { hex: "#B8E986", name: "연두" },
  { hex: "#4DE3A2", name: "초록" },
  { hex: "#5DE3E3", name: "청록" },
  { hex: "#7DB8FF", name: "하늘" },
  { hex: "#5D7DFF", name: "파랑" },
  { hex: "#9D7DFF", name: "보라" },
  { hex: "#E37DFF", name: "자주" },
];

export interface ColorPaletteBarProps {
  node: ColorSwatchTarget;
  onSelectColor: (color: string) => void;
  onClose: () => void;
  /** 넘기면 "기본색" 칩이 붙는다(커스텀 색 제거 - 엣지/노드 공용). */
  onResetColor?: () => void;
  /** 노드 전용: 달성 연출 프리셋 줄. 현재값과 선택 콜백을 같이 넘긴다. */
  glowEffect?: string;
  onSelectGlow?: (glowId: string) => void;
}

export function ColorPaletteBar({
  node,
  onSelectColor,
  onClose,
  onResetColor,
  glowEffect,
  onSelectGlow,
}: ColorPaletteBarProps) {
  // Esc는 팔레트만 닫는다(편집 모드 자체는 유지) - 캔버스 자체의 전역 Esc
  // 핸들러(정보 카드 닫기, 편집 모드에선 어차피 렌더 안 됨)와는 독립적으로 동작한다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 스포이드(EyeDropper API)는 크로미움 전용 - 미지원 브라우저에서는 버튼을
  // 숨기지 않고 비활성+툴팁으로 강등한다. 기능이 '없는 것'과 '이 브라우저에선
  // 안 되는 것'을 구분해 주는 쪽이 낫다(시안 방침 그대로).
  const [eyedropperSupported] = useState(
    () => typeof window !== "undefined" && typeof window.EyeDropper === "function"
  );

  // input[type=color]는 피커에서 드래그하는 동안 change가 연발된다 - 그대로
  // 흘리면 뮤테이션 큐에 색 하나 고르는 데 수십 건이 쌓이므로 250ms 디바운스.
  const colorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    };
  }, []);
  function handleCustomColor(hex: string) {
    if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => onSelectColor(hex.toUpperCase()), 250);
  }

  async function handleEyedrop() {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      onSelectColor(result.sRGBHex.toUpperCase());
    } catch {
      // 사용자가 Esc로 채집을 취소 - 아무 일도 없던 것으로.
    }
  }

  const currentHex = (node.color ?? TYPE_DEFAULT_HEX[node.type])?.toUpperCase();

  return (
    <div
      role="dialog"
      aria-label={`${node.label} 색상 팔레트`}
      className={cn(
        "paper-surface fixed left-1/2 z-30 w-[min(92vw,420px)] -translate-x-1/2 origin-bottom",
        "animate-[islandExpand_220ms_cubic-bezier(.22,1,.36,1)]",
        "rounded-xl border border-paper-line bg-paper-soft/95 p-3 shadow-panel backdrop-blur-md",
        // 모바일은 탭바 바로 위에 고정한다 - 이전엔 바텀시트(군집/노트 패널)의
        // max-h(46vh)만큼 밀어 올렸지만, 시트는 내용 크기만큼만 커지므로
        // 실제로 시트가 짧을 때는 팔레트가 허공에 떠 보였다. z-30(시트는
        // z-20)이 이미 시트 위에 뜨는 걸 보장하니 오프셋은 탭바 높이만
        // 신경 쓰면 된다 - 데스크톱은 그 패널이 우측에 있으므로 하단
        // 중앙에 그냥 띄우면 된다.
        "bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+16px)] md:bottom-6"
      )}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="min-w-0 truncate font-sans text-xs font-medium text-paper-ink">{node.label}</span>
        <button
          type="button"
          aria-label="팔레트 닫기"
          onClick={onClose}
          className="rounded p-1 text-paper-lo transition-colors hover:bg-paper hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        {SWATCHES.map((swatch) => {
          const selected = currentHex === swatch.hex;
          return (
            <button
              key={swatch.hex}
              type="button"
              aria-label={`${swatch.name} 색으로 바꾸기`}
              aria-pressed={selected}
              onClick={() => onSelectColor(swatch.hex)}
              className={cn(
                // 밝은 스와치(#E8ECFF/#E8EAF2/#FFF3C4)는 paper-soft 바탕과
                // 거의 안 섞여 border-paper-line만으로는 경계가 안 보였다 -
                // 전 스와치에 옅은 잉크 링을 둘러 항상 원 모양이 읽히게
                // 하고, 선택 상태는 그보다 굵고 진한 ring-2로 구분한다
                // (Tailwind ring 스케일이 오름차순으로 컴파일되므로 선택 시
                // ring-2가 항상 이긴다).
                "h-8 w-8 shrink-0 rounded-full border border-paper-line ring-1 ring-paper-ink/20 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
                selected && "ring-2 ring-paper-ink ring-offset-2 ring-offset-paper-soft"
              )}
              style={{ backgroundColor: swatch.hex }}
            />
          );
        })}
        {onResetColor && (
          <button
            type="button"
            aria-label="기본색으로 되돌리기"
            onClick={onResetColor}
            className="h-8 shrink-0 rounded-full border border-paper-line px-2.5 font-sans text-micro text-paper-lo transition-colors hover:bg-paper hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
          >
            기본색
          </button>
        )}
      </div>

      {/* 자유 팔레트 + 커스텀 - 별상 전환으로 색은 온전히 사용자의 선택이 됐다
          (유형 식별은 형태가 담당). 위 줄은 "기본 추천값"으로 유지. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-paper-line pt-2">
        {FREE_SWATCHES.map((swatch) => {
          const selected = currentHex === swatch.hex;
          return (
            <button
              key={swatch.hex}
              type="button"
              aria-label={`${swatch.name} 색으로 바꾸기`}
              aria-pressed={selected}
              onClick={() => onSelectColor(swatch.hex)}
              className={cn(
                "h-7 w-7 shrink-0 rounded-full border border-paper-line ring-1 ring-paper-ink/20 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
                selected && "ring-2 ring-paper-ink ring-offset-2 ring-offset-paper-soft"
              )}
              style={{ backgroundColor: swatch.hex }}
            />
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label="스포이드로 화면의 색 채집"
            title={
              eyedropperSupported
                ? "화면의 아무 색이나 채집해 적용"
                : "이 브라우저는 스포이드(EyeDropper API)를 지원하지 않아요"
            }
            disabled={!eyedropperSupported}
            onClick={() => void handleEyedrop()}
            className="flex h-7 items-center gap-1 rounded-full border border-paper-line px-2 font-sans text-micro text-paper-lo transition-colors hover:bg-paper hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-paper-lo"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="transparent" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M10.5 1.5l4 4-7.5 7.5-4.2 1.2 1.2-4.2z" />
              <path d="M9 3l4 4" />
            </svg>
            스포이드
          </button>
          <input
            type="color"
            aria-label="커스텀 색 선택"
            // 노드가 바뀌면 현재색으로 다시 초기화되도록 key를 건다 -
            // 피커 드래그 중 리렌더로 값이 되돌아가지 않게 비제어로 둔다.
            key={node.id}
            defaultValue={(currentHex ?? "#FFD9A0").toLowerCase()}
            onChange={(e) => handleCustomColor(e.target.value)}
            className="h-7 w-9 shrink-0 cursor-pointer rounded border border-paper-line bg-paper p-0.5"
          />
        </div>
      </div>

      {/* 달성 연출 프리셋(노드 전용) - 서버는 id만 저장, 시각 정의는
          ConstellationCanvas.GLOW_PRESETS가 단일 소유. */}
      {onSelectGlow && (
        <div className="mt-2.5 border-t border-paper-line pt-2.5">
          <span className="font-sans text-micro font-medium text-paper-lo">달성 연출</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {GLOW_PRESETS.map((preset) => {
              const selected = (glowEffect ?? "spike") === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectGlow(preset.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-sans text-micro transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
                    selected
                      ? "border-paper-ink bg-paper-ink font-medium text-paper"
                      : "border-paper-line text-paper-lo hover:bg-paper hover:text-paper-ink"
                  )}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
