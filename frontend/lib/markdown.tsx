/**
 * 노트 본문을 위한 아주 작은 마크다운 렌더러.
 *
 * 라이브러리를 설치하지 않고, dangerouslySetInnerHTML도 쓰지 않는다 - 문자열을
 * HTML로 파싱해 주입하는 경로 자체가 없으므로 인젝션이 구조적으로 불가능하다.
 * 대신 텍스트를 직접 React 엘리먼트 트리로 변환한다.
 *
 * 지원 문법(의도적으로 이 목록으로 제한): 헤딩(#~###), **굵게**, *기울임*,
 * `인라인 코드`, 펜스 코드 블록(```), 순서/비순서 목록, 인용문(>), 링크
 * [text](url), 그리고 원소 위키링크 [[라벨]]. 그 외 문법은 에러 없이 그냥
 * 평범한 텍스트로 남는다(파싱 실패 시 안전한 폴백).
 */

import type { ReactNode } from "react";

export interface WikiLinkTarget {
  nodeId: string;
}

/** 라벨로 그래프 노드를 찾는다. 못 찾으면 undefined - 호출부가 "존재하지
 * 않는 링크"를 다르게(흐리게, 클릭 불가) 그릴 수 있게 한다. */
export type ResolveWikiLink = (label: string) => WikiLinkTarget | undefined;

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "code"; content: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;
const FENCE_RE = /^```/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (FENCE_RE.test(line.trim())) {
      i += 1;
      const content: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        content.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 펜스 건너뛰기(없어도 안전)
      blocks.push({ kind: "code", content: content.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        const m = QUOTE_RE.exec(lines[i]);
        qLines.push(m ? m[1] : "");
        i += 1;
      }
      blocks.push({ kind: "quote", lines: qLines });
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = ordered ? OL_RE.exec(l) : UL_RE.exec(l);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE_RE.test(lines[i].trim()) &&
      !HEADING_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: pLines.join(" ") });
  }

  return blocks;
}

// 순서 중요: wikilink -> link -> bold -> code -> italic. bold(**)가 italic(*)보다
// 먼저 시도돼야 "**굵게**"의 첫 * 두 개가 italic으로 잘못 먹히지 않는다.
const INLINE_RE =
  /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;

function renderInline(
  text: string,
  resolveLink: ResolveWikiLink | undefined,
  onLinkClick: ((nodeId: string) => void) | undefined,
  keyPrefix: string
): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${idx}`;
    idx += 1;

    if (match[1] !== undefined) {
      // [[위키링크]]
      const label = match[1];
      const target = resolveLink?.(label);
      if (target) {
        out.push(
          <button
            key={key}
            type="button"
            className="rounded text-spec-b underline decoration-dotted underline-offset-2 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            onClick={() => onLinkClick?.(target.nodeId)}
          >
            {label}
          </button>
        );
      } else {
        out.push(
          <span
            key={key}
            className="cursor-default rounded text-text-lo opacity-40"
            aria-disabled="true"
            title="연결된 원소를 찾을 수 없음"
          >
            {label}
          </span>
        );
      }
    } else if (match[2] !== undefined) {
      // [text](url)
      out.push(
        <a
          key={key}
          href={match[3]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-spec-b underline underline-offset-2 hover:text-text-hi"
        >
          {match[2]}
        </a>
      );
    } else if (match[4] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-text-hi">{match[4]}</strong>);
    } else if (match[5] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-ink-900 px-1 py-0.5 font-mono text-[0.85em] text-text-hi">
          {match[5]}
        </code>
      );
    } else if (match[6] !== undefined) {
      out.push(<em key={key}>{match[6]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

export interface MarkdownProps {
  text: string;
  resolveLink?: ResolveWikiLink;
  onLinkClick?: (nodeId: string) => void;
  className?: string;
}

/** 노트 본문을 렌더링한다. 빈 문자열이면 아무것도 그리지 않는다. */
export function Markdown({ text, resolveLink, onLinkClick, className }: MarkdownProps) {
  if (!text.trim()) return null;
  const blocks = parseBlocks(text);

  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const keyPrefix = `b${bi}`;
        switch (block.kind) {
          case "heading": {
            const Tag = (`h${block.level}` as unknown) as "h1" | "h2" | "h3";
            const sizeClass =
              block.level === 1 ? "text-base" : block.level === 2 ? "text-[0.95rem]" : "text-sm";
            return (
              <Tag key={bi} className={`${sizeClass} mb-1 mt-3 font-bold text-text-hi first:mt-0`}>
                {renderInline(block.text, resolveLink, onLinkClick, keyPrefix)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre
                key={bi}
                className="my-2 overflow-x-auto rounded-md border border-rule bg-ink-900 p-2.5 font-mono text-xs text-text-hi"
              >
                <code>{block.content}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote
                key={bi}
                className="my-2 border-l-2 border-rule pl-3 text-text-lo"
              >
                {block.lines.map((line, li) => (
                  <p key={li} className="leading-relaxed">
                    {renderInline(line, resolveLink, onLinkClick, `${keyPrefix}-${li}`)}
                  </p>
                ))}
              </blockquote>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag
                key={bi}
                className={`my-2 space-y-0.5 pl-5 leading-relaxed ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, ii) => (
                  <li key={ii}>{renderInline(item, resolveLink, onLinkClick, `${keyPrefix}-${ii}`)}</li>
                ))}
              </ListTag>
            );
          }
          case "paragraph":
          default:
            return (
              <p key={bi} className="mb-2 leading-relaxed last:mb-0">
                {renderInline(block.text, resolveLink, onLinkClick, keyPrefix)}
              </p>
            );
        }
      })}
    </div>
  );
}
