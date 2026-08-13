"use client";

import { useState } from "react";
import { BeanIcon, Chip, Modal } from "@/components/ui";
import { ApiError, purchaseBeans } from "@/lib/api";
import type { BeanPackageId } from "@/lib/types";

const PACKAGES: { id: BeanPackageId; beans: number; price: string; tag?: string }[] = [
  { id: "bean_10", beans: 10, price: "₩1,000" },
  { id: "bean_55", beans: 55, price: "₩5,000", tag: "+10% 보너스" },
  { id: "bean_120", beans: 120, price: "₩10,000", tag: "+20% 보너스" },
];

interface BeanShopModalProps {
  currentBalance: number;
  onClose: () => void;
  onPurchased: (newBalance: number) => void;
}

export function BeanShopModal({ currentBalance, onClose, onPurchased }: BeanShopModalProps) {
  const [pendingId, setPendingId] = useState<BeanPackageId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function buy(packageId: BeanPackageId) {
    if (pendingId) return;
    setPendingId(packageId);
    setError(null);
    try {
      const res = await purchaseBeans(packageId);
      setNotice(res.detail);
      onPurchased(res.bean_balance);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "결제에 실패했어요.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="콩 충전" size="sm">
      <p className="mb-5 text-caption leading-relaxed text-content-muted">
        현재 보유 {currentBalance}개 · 충전한 콩은 시든 콩나무 정리에 쓸 수 있어요.
        <br />
        <span className="text-wither">랭킹에는 직접 수확한 콩만 집계돼요.</span>
      </p>

      <div className="flex flex-col gap-2.5">
        {PACKAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pendingId !== null}
            onClick={() => void buy(p.id)}
            className="flex items-center gap-3 rounded-md border border-line bg-white/6 px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-goal/12 disabled:opacity-50"
          >
            <BeanIcon size={20} className="shrink-0 text-bloom" />
            <span className="text-body-sm font-bold text-content-primary">{p.beans}개</span>
            {p.tag && (
              <Chip tone="bloom" size="sm" selected>
                {p.tag}
              </Chip>
            )}
            <span className="ml-auto text-body-sm font-semibold text-goal-bright">
              {pendingId === p.id ? "결제 중…" : p.price}
            </span>
          </button>
        ))}
      </div>

      {notice && !error && <p className="mt-4 text-caption text-growth-bright">{notice}</p>}
      {error && <p className="mt-4 text-caption text-wither">{error}</p>}
      <p className="mt-4 text-micro leading-relaxed text-content-muted">
        개발 단계라 실제 결제는 이루어지지 않아요 (모의 결제). 정식 오픈 시 결제 수단
        연동과 환불 정책이 함께 제공됩니다.
      </p>
    </Modal>
  );
}
