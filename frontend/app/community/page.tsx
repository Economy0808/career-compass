"use client";

/*
 * 커뮤니티 홈 - "커뮤니티" 버튼을 누르면 게시판들이 나온다(사용자 지시).
 * 오르비처럼 익명이 기본, 에타처럼 게시판이 여러 개다. 서버 GET
 * /api/community/boards 응답이 오면 그 name/description을 우선 쓰고,
 * 실패하면 lib/community-api.ts의 BOARDS 상수로 조용히 대체한다(화면 사망 금지).
 *
 * 카드 미리보기(사용자 지시: "각 게시판 제목 아래에 최근 글 또는 가장 핫한글이
 * 미리보기처럼 본문 몇줄이 떴으면") - 게시판별 글 목록을 병렬 조회해 핫글
 * 1개(좋아요×2+댓글, 동점이면 최신)를 제목+본문 2줄로 보여준다. 조회 실패나
 * 빈 게시판은 미리보기 없이 기존 카드 그대로(화면 사망 금지 동일 원칙).
 * ponytail: 미리보기용으로 게시판 전체 글 목록을 6번 받는다 - 글 수가 적은
 * 지금은 충분하고, 무거워지면 백엔드에 보드별 프리뷰 엔드포인트를 요청한다.
 *
 * 미인증 진입 차단(사용자 지시 8번 - "커뮤니티 탭에서 지금 각 게시판 들어갈
 * 수 있고" 재차단): 최상위 화면(이 카드 목록)은 보여주되, 카드를 눌러 게시판
 * 안으로 들어가는 클릭 자체를 막는다. VerifyGate/isVerifyRequiredError는 이미
 * 있는 인증 안내 컴포넌트를 그대로 재사용 - 새 패턴 발명 금지.
 */

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { VerifyGate } from "@/components/VerifyGate";
import { useAuth } from "@/lib/auth-context";
import {
  BOARDS,
  listBoardPosts,
  listBoards,
  type BoardDto,
  type CommunityPostDto,
} from "@/lib/community-api";
import { relativeTimeKo } from "@/lib/format";

function hotScore(post: CommunityPostDto): number {
  return post.likeCount * 2 + post.commentCount;
}

/** 핫글 우선(사용자 승인 기준): 반응 점수 최고, 동점이면 최신. 반응이 전무한
 * 게시판에서는 자연스럽게 최신 글이 된다 - 규칙 하나로 둘 다 커버. */
function pickHottest(posts: CommunityPostDto[]): CommunityPostDto | null {
  if (posts.length === 0) return null;
  return [...posts].sort((a, b) => hotScore(b) - hotScore(a) || b.createdAt - a.createdAt)[0];
}

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
  const { user } = useAuth();
  const [boards, setBoards] = useState<BoardDto[] | null>(null);
  // boardId -> 핫글. 아직 안 온 게시판은 키 자체가 없다(카드는 미리보기 없이 렌더).
  const [previews, setPreviews] = useState<Record<string, CommunityPostDto>>({});
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);

  /** 로그인은 했지만 미인증이면 게시판 진입 자체를 막는다. 비로그인은 기존
   * 그대로(이 화면은 원래 열람에 로그인을 요구하지 않았다 - 건드리지 않는다). */
  function guardBoardEntry(e: MouseEvent<HTMLAnchorElement>) {
    if (user && !user.yonseiVerified) {
      e.preventDefault();
      setVerifyGateOpen(true);
    }
  }

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

  // 게시판 목록이 정해지면 미리보기를 게시판별로 병렬 조회 - 먼저 온 것부터
  // 하나씩 채워진다(전체 대기 없음). 실패는 조용히 미리보기 생략.
  useEffect(() => {
    if (boards === null) return;
    let cancelled = false;
    for (const board of boards) {
      listBoardPosts(board.id)
        .then((posts) => {
          if (cancelled) return;
          const hottest = pickHottest(posts);
          if (hottest) setPreviews((prev) => ({ ...prev, [board.id]: hottest }));
        })
        .catch(() => {
          // 미리보기는 부가 정보 - 실패해도 카드 본체는 그대로.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [boards]);

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
          {boards.map((board) => {
            const preview = previews[board.id];
            return (
              <Link
                key={board.id}
                href={`/community/${board.id}`}
                onClick={guardBoardEntry}
                className="block rounded-lg border border-rule bg-ink-800/70 p-4 no-underline backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
              >
                <h2 className="font-sans text-body font-semibold text-text-hi">{board.name}</h2>
                <p className="mt-1 text-body-sm text-text-lo">{board.description}</p>
                {preview && (
                  <div className="mt-3 border-t border-rule/60 pt-2.5">
                    <p className="truncate font-sans text-body-sm font-medium text-text-hi">{preview.title}</p>
                    {preview.body && (
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-caption leading-relaxed text-text-lo">
                        {preview.body}
                      </p>
                    )}
                    {/* No-Korean-Mono: mono는 숫자에만(게시판 목록 페이지와 같은 관례). */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-text-lo">
                      <span>
                        좋아요 <span className="font-mono">{preview.likeCount}</span>
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        댓글 <span className="font-mono">{preview.commentCount}</span>
                      </span>
                      <span aria-hidden>·</span>
                      <span>{relativeTimeKo(preview.createdAt)}</span>
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
    </div>
  );
}
