"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const COLORS = ["#5F8A4C", "#7FA669", "#5B7A99", "#C15F3C", "#A3A092"];

export function Confetti() {
  const [particles] = useState(() =>
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 260,
      y: -(Math.random() * 220 + 100),
      rotate: Math.random() * 360,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 0.15,
    }))
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex justify-center">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute h-2 w-2 rounded-sm"
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate }}
          transition={{ duration: 1, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
