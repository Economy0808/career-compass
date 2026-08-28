"use client";

/*
 * 커뮤니티 홈 - "커뮤니티" 버튼을 누르면 게시판들이 나온다(사용자 지시).
 * 오르비처럼 익명이 기본, 에타처럼 게시판이 여러 개다. 서버 GET
 * /api/community/boards 응답이 오면 그 name/description을 우선 쓰고,
 * 실패하면 lib/community-api.ts의 BOARDS 상수로 조용히 대체한다(화면 사망 금지).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { BOARDS, listBoards, type BoardDto } from "@/lib/community-api";

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[72px] animate-pulse rounded-lg border border-rule bg-ink-800/70" />
      ))}
    </div>
  );
}

export default function CommunityPage() {
  const [boards, setBoards] = useState<BoardDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBoards()
      .then((list) => {
        if (!cancelled) setBoards(list);
      })
      .catch(() => {
        // 백엔드 계약이 아직 확정 전이거나 서버가 죽어 있어도 폴백 상수로 굴러간다.
        if (!cancelled) setBoards([...BOARDS]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-8 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">커뮤니티</h1>
        <span className="font-mono text-caption tracking-[0.14em] text-text-lo">BOARDS · {BOARDS.length}</span>
      </header>

      {boards === null ? (
        <BoardSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {boards.map((board) => (
            <Link
              key={board.id}
              href={`/community/${board.id}`}
              className="block rounded-lg border border-rule bg-ink-800/70 p-4 no-underline backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
            >
              <h2 className="font-sans text-body font-semibold text-text-hi">{board.name}</h2>
              <p className="mt-1 text-body-sm text-text-lo">{board.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
