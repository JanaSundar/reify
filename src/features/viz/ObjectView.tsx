"use client";

import type { RecordObject } from "@/engine/core/protocol/values";
import { CollectionFrame, EntryValue, useChanges, type RenderValue } from "./atoms";
import { EntryRows } from "./EntryRows";

/**
 * An object as a property inspector: aligned name/value rows. Nested objects, arrays and
 * references are drawn by `renderValue` (collapsible, with identity chips), so shared and
 * cyclic references are shown as references, never duplicated.
 */
export function ObjectView({
  object,
  renderValue,
}: {
  object: RecordObject;
  renderValue: RenderValue;
}) {
  const changes = useChanges(object);
  return (
    <CollectionFrame object={object} changes={changes} empty={object.fields.length === 0}>
      <EntryRows
        separator=":"
        keyClassName="text-muted"
        rows={object.fields.map(([name, value]) => ({
          id: name,
          label: name,
          labelLength: name.length,
          change: changes.entries.get(name),
          value: <EntryValue value={value} renderValue={renderValue} />,
        }))}
      />
    </CollectionFrame>
  );
}
