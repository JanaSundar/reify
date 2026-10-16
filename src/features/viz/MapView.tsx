"use client";

import type { MapObject } from "@/engine/core/protocol/values";
import { CollectionFrame, EntryValue, useChanges, type RenderValue } from "./atoms";
import { entryKey } from "./changes";
import { EntryRows } from "./EntryRows";

/** Label width reserved for a key that is itself an object (drawn as a chip). */
const OBJECT_KEY_LENGTH = 10;

/**
 * A map as key → value rows in the runtime's iteration order. Keys are typed values (shown
 * with their literal formatting, so `1` and `"1"` differ); rows are identified by key.
 */
export function MapView({ object, renderValue }: { object: MapObject; renderValue: RenderValue }) {
  const changes = useChanges(object);
  return (
    <CollectionFrame object={object} changes={changes} empty={object.entries.length === 0}>
      <EntryRows
        separator="→"
        keyClassName="text-text"
        rows={object.entries.map(([key, value]) => {
          const id = entryKey(key);
          return {
            id,
            label: <EntryValue value={key} renderValue={renderValue} />,
            labelLength: key.kind === "primitive" ? key.text.length : OBJECT_KEY_LENGTH,
            change: changes.entries.get(id),
            value: <EntryValue value={value} renderValue={renderValue} />,
          };
        })}
      />
    </CollectionFrame>
  );
}
