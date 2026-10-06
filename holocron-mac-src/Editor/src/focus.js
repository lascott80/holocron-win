// Tracks whether the editor has focus as editor state, so state fields
// (which can't see the DOM) can show raw markdown only while editing.
import { EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

export const setFocused = StateEffect.define();

export const focusedField = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFocused)) value = effect.value;
    return value;
  },
});

export const focusTracking = [
  focusedField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
];

/** True if the editor is focused and any selection touches [from, to]. */
export function isEditing(state, from, to) {
  return state.field(focusedField, false) === true
    && state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

export function focusChanged(transaction) {
  return transaction.effects.some((effect) => effect.is(setFocused));
}
