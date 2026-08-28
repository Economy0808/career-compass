"use client";

/**
 * 편집 모드에서 선택한 노드의 색을 바꾸는 직사각형 팔레트 바.
 *
 * 하단 중앙에 뜨는 종이 섬(islandExpand 재사용) - 스와치는 DESIGN.md에 이미
 * 고정된 토큰 hex만 쓴다(새 hex 금지). 여기서 고른 색은 그대로
 * NodeDto.color(#RRGGBB) 문자열로 서버에 저장되므로 CSS 변수 참조가 아니라
 * 실제 hex 값을 다룬다.
 */

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "@/components/ui/icons";

export interface ColorSwatchTarget {
  id: string;
  label: string;
  type: string;
  color?: string;
}

// DESIGN.md 색 토큰과 1:1 대응하는 고정 팔레트. globals.css/tailwind.config.ts의
// --spec-*/--lit/--text-hi 실값과 같은 hex이므로 새 색이 아니다.
const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#9DB4FF", name: "항성청" },
  { hex: "#E8ECFF", name: "자격증" },
  { hex: "#FFD98A", name: "학회" },
  { hex: "#FFA76B", name: "대외활동" },
  { hex: "#FF7B72", name: "네트워킹" },
  { hex: "#FFF3C4", name: "별빛" },
  { hex: "#E8EAF2", name: "본문" },
];

// 유형별 기본색의 hex 등가물 - element-colors.ts는 렌더용 CSS 변수 문자열
// (var(--spec-b) 등)만 내보내므로, "지금 이 스와치가 적용 중" 링 표시를 위한
// hex 비교값을 여기서만 별도로 둔다(값은 globals.css --spec-*와 동일 - 그
// 토큰을 바꾸면 여기도 같이 봐야 한다).
const TYPE_DEFAULT_HEX: Record<string, string> = {
  course: "#9DB4FF",
  certification: "#E8ECFF",
  organization: "#FFD98A",
  activity: "#FFA76B",
  networking: "#FF7B72",
};

export interface ColorPaletteBarProps {
  node: ColorSwatchTarget;
  onSelectColor: (color: string) => void;
  onClose: () => void;
}

export function ColorPaletteBar({ node, onSelectColor, onClose }: ColorPaletteBarProps) {
  // Esc는 팔레트만 닫는다(편집 모드 자체는 유지) - 캔버스 자체의 전역 Esc
  // 핸들러(정보 카드 닫기, 편집 모드에선 어차피 렌더 안 됨)와는 독립적으로 동작한다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
      </div>
    </div>
  );
}
