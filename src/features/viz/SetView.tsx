"use client";

import { AnimatePresence, motion } from "motion/react";
import { LAYOUT, POP } from "@/components/motion";
import type { SetObject } from "@/engine/core/protocol/values";
import { CollectionFrame, EntryValue, toneOf, useChanges, type RenderValue } from "./atoms";
import { entryKey } from "./changes";

/**
 * A set as value chips in the runtime's iteration order. Values are unique, so each chip is
 * keyed by the value itself; a rejected duplicate shows as "no change".
 */
export function SetView({ object, renderValue }: { object: SetObject; renderValue: RenderValue }) {
  const changes = useChanges(object);
  return (
    <CollectionFrame object={object} changes={changes} empty={object.items.length === 0}>
      <ul className="relative flex flex-wrap gap-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {object.items.map((item) => {
            const id = entryKey(item);
            const change = changes.entries.get(id);
            return (
              <motion.li
                key={id}
                layout="position"
                transition={LAYOUT}
                {...POP}
                aria-label={
                  change ? `${item.kind === "primitive" ? item.text : id} (${change})` : undefined
                }
                className={`rounded-full px-2.5 py-0.5 text-sm transition-[background-color,box-shadow] duration-200 ${toneOf(change)}`}
              >
                <EntryValue value={item} renderValue={renderValue} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </CollectionFrame>
  );
}
