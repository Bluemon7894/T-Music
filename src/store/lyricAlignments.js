// How far each track's lyrics had to be moved to line up with its recording.
import { create } from 'zustand';

const ALIGN_KEY = 't-music-lyric-align';
const MAX_SAVED_ALIGNMENTS = 300;

function loadAlignments() {
  try {
    return JSON.parse(localStorage.getItem(ALIGN_KEY)) || {};
  } catch {
    return {};
  }
}

export const useAlignments = create(() => ({ map: loadAlignments() }));

// An alignment only holds for the lyrics it was measured with.
export const lyricsKey = (data) => `${data?.source || ''}:${data?.lines?.length || 0}:${data?.lines?.[0]?.time ?? ''}`;

export function saveAlignment(id, data, offset) {
  const map = { ...useAlignments.getState().map };
  delete map[id];
  if (offset !== null) map[id] = { offset, lyrics: lyricsKey(data) };
  for (const old of Object.keys(map).slice(0, -MAX_SAVED_ALIGNMENTS)) delete map[old];
  useAlignments.setState({ map });
  try { localStorage.setItem(ALIGN_KEY, JSON.stringify(map)); } catch { /* it still applies this session */ }
}
