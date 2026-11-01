// Ctrl+Z. Everything someone can do leaves a note here on how to take it back.
import { toast } from './ui.js';
import { tr } from '../lib/i18n.js';

const MAX_STEPS = 60;
const MERGE_WITHIN_MS = 1500;

const steps = [];
let undoing = false;
let group = null;

export const isUndoing = () => undoing;

// `merge` is for things that come in a stream, such as dragging a slider: only the first one counts.
export function record(label, undo, merge = null) {
  if (undoing) return;
  if (group) {
    group.push(undo);
    return;
  }
  const last = steps[steps.length - 1];
  if (merge && last?.merge === merge && Date.now() - last.at < MERGE_WITHIN_MS) {
    last.at = Date.now();
    return;
  }
  steps.push({ label, undo, merge, at: Date.now() });
  if (steps.length > MAX_STEPS) steps.shift();
}

// Several changes that were one action, such as dropping an album into a list.
export function together(label, work) {
  if (group) return work();
  group = [];
  let result;
  try {
    result = work();
  } finally {
    const undos = group;
    group = null;
    if (undos.length) record(label, () => { for (const undo of undos.reverse()) undo(); });
  }
  return result;
}

export async function undoLast() {
  const step = steps.pop();
  if (!step) {
    toast(tr('되돌릴 작업이 없어요'));
    return;
  }
  undoing = true;
  try {
    await step.undo();
    toast(tr('되돌렸어요: {0}', step.label));
  } catch (e) {
    console.warn('[undo]', e);
    toast(tr('되돌리지 못했어요: {0}', step.label));
  } finally {
    undoing = false;
  }
}

export function clearUndo() {
  steps.length = 0;
}
