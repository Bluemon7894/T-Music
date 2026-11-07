// Motion helpers on top of anime.js v4.
import { useLayoutEffect, useEffect, useRef } from 'react';
import { animate as animeAnimate, stagger, spring, createAnimatable, createTimeline, utils } from 'animejs';
import { IS_ANDROID } from './platform.js';

const systemReduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export let reduced = systemReduced;
export function setCalmMotion(on) {
  reduced = systemReduced || on;
  calmMotion = on;
}

// With motion turned down, everything still ends up in the same place, just right away.
export const animate = (targets, params) => animeAnimate(targets, reduced ? { ...params, duration: 1, delay: 0, ease: 'linear' } : params);

const DECK_FRAME_MS = { calm: 1000, phone: 33, resting: 250 }; // with motion turned down, a deck all but stops
let calmMotion = false;

// How long a deck waits between drawing frames. A stopped disc barely needs drawing at all.
export function deckFrameGap(resting) {
  if (calmMotion) return DECK_FRAME_MS.calm;
  if (resting) return DECK_FRAME_MS.resting;
  return IS_ANDROID ? DECK_FRAME_MS.phone : 0;
}

export const ease = {
  soft: spring({ bounce: 0.18, duration: 520 }),
  bouncy: spring({ bounce: 0.42, duration: 620 }),
  snap: spring({ bounce: 0.1, duration: 320 }),
};

// Staggered 3D rise for everything marked [data-enter] inside root.
export function enter(root, selector = '[data-enter]', { delay = 40, step = 42 } = {}) {
  if (!root || reduced) return;
  const els = [...root.querySelectorAll(selector)];
  if (!els.length) return;
  utils.set(els, { opacity: 0, translateY: 26, rotateX: -12, scale: 0.98 });
  animate(els, {
    opacity: 1,
    translateY: 0,
    rotateX: 0,
    scale: 1,
    delay: stagger(step, { start: delay }),
    ease: ease.soft,
    // Done: hand the elements back to their stylesheet (hover effects etc. use transform too).
    onComplete: () => els.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; }),
  });
}

export function useEnter(ref, deps, opts) {
  useLayoutEffect(() => { enter(ref.current, undefined, opts); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function pop(el, from = 0.82) {
  if (!el || reduced) return;
  animate(el, { scale: [from, 1], ease: ease.bouncy });
}

// Pointer-following 3D tilt with a moving highlight (--gx/--gy).
export function useTilt(ref, { max = 12, scale = 1.03, enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reduced || IS_ANDROID) return;
    const a = createAnimatable(el, { rotateX: 450, rotateY: 450, scale: 450, ease: 'out(4)' });
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      a.rotateY((x - 0.5) * max * 2);
      a.rotateX((0.5 - y) * max * 2);
      a.scale(scale);
      el.style.setProperty('--gx', `${x * 100}%`);
      el.style.setProperty('--gy', `${y * 100}%`);
    };
    const leave = () => { a.rotateX(0); a.rotateY(0); a.scale(1); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      a.revert?.();
    };
  }, [ref, max, scale, enabled]);
}

// Little particle burst used by the like button.
export function burst(el, color = '#c4b5fd') {
  if (!el || reduced) return;
  const r = el.getBoundingClientRect();
  const dots = Array.from({ length: 10 }, () => {
    const d = document.createElement('i');
    d.className = 'burst-dot';
    d.style.left = `${r.left + r.width / 2}px`;
    d.style.top = `${r.top + r.height / 2}px`;
    d.style.background = color;
    document.body.appendChild(d);
    return d;
  });
  animate(dots, {
    translateX: () => utils.random(-34, 34),
    translateY: () => utils.random(-34, 34),
    scale: [1, 0],
    opacity: [1, 0],
    duration: () => utils.random(420, 640),
    ease: 'out(3)',
    onComplete: () => dots.forEach((d) => d.remove()),
  });
  animate(el, { scale: [1, 1.35, 1], duration: 420, ease: 'out(3)' });
}

// ---- the desktop's bigger moves. Phones and "fewer animations" skip them. ----
const big = () => !reduced && !IS_ANDROID;

// Where the pointer last went down, for animations that start "where you clicked" (a menu item is
// gone by the time its action runs).
let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);

function ghost(src, rect, radius) {
  const g = document.createElement('img');
  g.className = 'flight-ghost';
  g.src = src;
  Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: radius || '12px' });
  document.body.appendChild(g);
  return g;
}

// A card's cover flies into the page it opens. The card calls launchFlight; the page's header calls
// landFlight on its cover when it appears, and the cover is hidden until the flight lands on it.
let flight = null;
const FLIGHT_WAIT_MS = 2500;
export function launchFlight(el, src) {
  if (!big() || !el || !src) { flight = null; return; }
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  flight = { rect, src, at: performance.now(), radius: getComputedStyle(el).borderRadius };
}
// `src`: land only on this picture (a card among many, on the way back); others leave the flight be.
export function landFlight(target, src) {
  const f = flight;
  if (src && f?.src !== src) return;
  flight = null;
  if (!f || !target || !big() || performance.now() - f.at > FLIGHT_WAIT_MS) return;
  const to = target.getBoundingClientRect();
  if (!to.width) return;
  const g = ghost(f.src, f.rect, f.radius);
  target.style.visibility = 'hidden';
  animeAnimate(g, {
    left: to.left, top: to.top, width: to.width, height: to.height,
    borderRadius: getComputedStyle(target).borderRadius,
    boxShadow: ['0 10px 30px rgba(0,0,0,0.4)', '0 40px 90px -20px rgba(8,4,20,0.85)'],
    ease: spring({ bounce: 0.22, duration: 640 }),
    onComplete: () => { target.style.visibility = ''; g.remove(); },
  });
}

// A track added to the queue: its cover leaves from where you clicked and drops into the queue,
// or onto the queue button when the panel is closed.
export function flyToQueue(src) {
  if (!big() || !src) return;
  const target = document.querySelector('.now-panel .np-body') || document.querySelector('[data-queue-target]');
  if (!target) return;
  const to = target.getBoundingClientRect();
  const size = 46;
  const g = ghost(src, { left: lastPointer.x - size / 2, top: lastPointer.y - size / 2, width: size, height: size }, '10px');
  const endX = to.left + to.width / 2 - size / 2;
  const endY = to.top + Math.min(to.height / 2, 60) - size / 2;
  const lift = Math.min(lastPointer.y, endY) - 80;
  animeAnimate(g, {
    left: [lastPointer.x - size / 2, endX],
    top: [lastPointer.y - size / 2, lift, endY],
    scale: [1, 1.15, 0.35],
    opacity: [1, 1, 0],
    duration: 700,
    ease: 'inOut(2)',
    onComplete: () => {
      g.remove();
      animeAnimate(target, { scale: [1, 1.04, 1], duration: 380, ease: 'out(3)' });
    },
  });
}

// Rows marked data-flip glide to their new places when a list is reordered, instead of jumping.
export function useFlip(ref) {
  const last = useRef(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next = new Map();
    root.querySelectorAll('[data-flip]').forEach((n) => next.set(n.dataset.flip, n.offsetTop));
    if (big()) {
      root.querySelectorAll('[data-flip]').forEach((n) => {
        const before = last.current.get(n.dataset.flip);
        const now = next.get(n.dataset.flip);
        if (before != null && Math.abs(before - now) > 1) animeAnimate(n, { translateY: [before - now, 0], ease: spring({ bounce: 0.3, duration: 480 }) });
      });
    }
    last.current = next;
  });
}

export { stagger, utils, createTimeline };
