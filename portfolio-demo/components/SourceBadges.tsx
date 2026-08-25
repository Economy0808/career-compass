"use client";

import { useState } from "react";

/** URL에서 표시용 호스트명(www. 제거)을 뽑는다. 파싱 실패 시 원문. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 출처 하나 = 도메인 대표 로고(파비콘) 원형 칩. 로고를 못 불러오면 이니셜로 폴백. */
function SourceChip({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={host}
      className="block h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-line transition-transform hover:-translate-y-0.5 hover:ring-goal-bright motion-reduce:transition-none"
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center bg-white/10 text-micro font-bold uppercase text-content-secondary">
          {host.charAt(0)}
        </span>
      ) : (
        // 파비콘은 외부 동적 호스트라 next/image 대신 <img> — 28px 썸네일이라 최적화 불필요.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
          alt={host}
          onError={() => setFailed(true)}
          className="h-full w-full bg-white object-contain p-[3px]"
        />
      )}
    </a>
  );
}

/**
 * 브리핑 아래에 뜨는 출처 뱃지 줄 — 로드맵 초안이 웹 검색으로 참고한 출처의
 * 대표 로고들. 도메인별 1개, 최대 6개 + 나머지는 "+N".
 */
export default function SourceBadges({ urls }: { urls: string[] }) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const u of urls) {
    const host = hostOf(u);
    if (host && !seen.has(host)) {
      seen.add(host);
      unique.push(u);
    }
  }
  if (unique.length === 0) return null;

  const shown = unique.slice(0, 6);
  const extra = unique.length - shown.length;

  return (
    <div className="mb-3.5 -mt-1 flex flex-col gap-1.5">
      <span className="text-micro font-semibold uppercase tracking-[.08em] text-content-muted">
        AI가 찾아본 출처
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((u) => (
          <SourceChip key={u} url={u} />
        ))}
        {extra > 0 && (
          <span className="flex h-7 items-center rounded-full bg-surface-raised px-2 text-caption font-semibold text-content-secondary ring-1 ring-line">
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}
