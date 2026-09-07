import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** 라이트 종이 표면(societies/certifications 등)에 놓일 때 - 다크월드
   * 토큰 대신 paper-* 토큰을 쓴다. 기본값 false라 기존 호출부는 그대로. */
  paper?: boolean;
}

export function EmptyState({ title, description, action, paper = false }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed px-6 py-12 text-center", paper ? "border-paper-line" : "border-rule")}>
      <p className={cn("text-body font-semibold", paper ? "text-paper-ink" : "text-text-lo")}>{title}</p>
      {description && (
        <p className={cn("mx-auto mt-2 max-w-sm text-body-sm", paper ? "text-paper-lo" : "text-text-lo/80")}>
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
