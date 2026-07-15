"use client";

import { useState } from "react";
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
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,10,5,.72)] px-4 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[400px] rounded-2xl border border-[rgba(143,220,138,.2)] bg-[rgba(7,22,12,.96)] p-6 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
      >
        <div className="mb-1 flex items-start justify-between">
          <h2 className="font-serif text-[20px] font-bold text-moss-100">콩 충전</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2.5 py-1 text-[15px] text-moss-600 transition-colors hover:bg-[rgba(143,220,138,.12)] hover:text-moss-300"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <p className="mb-5 text-[12px] text-moss-600">
          현재 보유 🫘 {currentBalance}개 · 충전한 콩은 시든 콩나무 정리에 쓸 수 있어요.
          <br />
          <span className="text-wither-300">랭킹에는 직접 수확한 콩만 집계돼요.</span>
        </p>

        <div className="flex flex-col gap-2.5">
          {PACKAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pendingId !== null}
              onClick={() => void buy(p.id)}
              className="flex items-center gap-3 rounded-xl border border-[rgba(143,220,138,.2)] bg-[rgba(143,220,138,.06)] px-4 py-3.5 text-left transition-colors hover:border-[rgba(143,220,138,.45)] hover:bg-[rgba(143,220,138,.12)] disabled:opacity-50"
            >
              <span className="text-[22px]">🫘</span>
              <span className="text-[15px] font-bold text-moss-100">{p.beans}개</span>
              {p.tag && (
                <span className="rounded-full bg-[rgba(240,232,180,.14)] px-2 py-0.5 text-[10px] font-semibold text-bloom-300">
                  {p.tag}
                </span>
              )}
              <span className="ml-auto text-[14px] font-semibold text-bean-200">
                {pendingId === p.id ? "결제 중…" : p.price}
              </span>
            </button>
          ))}
        </div>

        {notice && !error && <p className="mt-4 text-[12.5px] text-bean-200">{notice}</p>}
        {error && <p className="mt-4 text-[12.5px] text-wither-300">{error}</p>}
        <p className="mt-4 text-[10.5px] leading-relaxed text-moss-700">
          ⚠️ 개발 단계라 실제 결제는 이루어지지 않아요 (모의 결제). 정식 오픈 시 결제
          수단 연동과 환불 정책이 함께 제공됩니다.
        </p>
      </div>
    </div>
  );
}
