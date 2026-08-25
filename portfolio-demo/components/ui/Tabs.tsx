"use client";

import { Chip } from "./Chip";

export interface TabsProps<T extends string> {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function Tabs<T extends string>({ items, value, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto">
      {items.map((it) => (
        <Chip key={it.value} interactive selected={it.value === value} onClick={() => onChange(it.value)}>
          {it.label}
        </Chip>
      ))}
    </div>
  );
}
