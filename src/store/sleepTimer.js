// Stops the music after a while, fading it out first so it doesn't wake anyone. In a room only this
// person drops out: everyone else keeps listening.
import { create } from 'zustand';
import { setMusicFade } from '../lib/audio.js';
import { tr } from '../lib/i18n.js';
import { usePlayer } from './player.js';
import { useRoom } from './room.js';
import { toast } from './ui.js';

const MINUTE_MS = 60 * 1000;
const FADE_S = 8;

let timer = null;

function stopMusic() {
  useRoom.getState().pause();
  const player = usePlayer.getState();
  if (player.playing) player.toggle();
  setMusicFade(1);
  toast(tr('취침 타이머로 재생을 멈췄어요'));
}

export const useSleepTimer = create((set) => ({
  minutes: 0,
  endsAt: 0,

  start(minutes) {
    clearTimeout(timer);
    if (!minutes) {
      set({ minutes: 0, endsAt: 0 });
      return;
    }
    set({ minutes, endsAt: Date.now() + minutes * MINUTE_MS });
    timer = setTimeout(() => {
      set({ minutes: 0, endsAt: 0 });
      if (!usePlayer.getState().playing) return;
      setMusicFade(0, FADE_S);
      timer = setTimeout(stopMusic, FADE_S * 1000);
    }, minutes * MINUTE_MS);
  },
}));
