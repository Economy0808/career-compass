"use client";

import { motion } from "framer-motion";
import type { ChatRole } from "@/lib/types";

export function ChatBubble({ role, content }: { role: ChatRole; content: string }) {
  const isAssistant = role === "assistant";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[80%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-soft ${
          isAssistant
            ? "rounded-tl-md bg-surface border border-border text-ink-900 dark:text-ink-50"
            : "rounded-tr-md bg-ink-900 text-white dark:bg-accent-500 dark:text-ink-950"
        }`}
      >
        {content}
      </div>
    </motion.div>
  );
}

export function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-1 rounded-3xl rounded-tl-md border border-border bg-surface px-4 py-3 shadow-soft">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-ink-400"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
