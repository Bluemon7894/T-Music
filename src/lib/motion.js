// Motion helpers on top of anime.js v4.
import { useLayoutEffect, useEffect } from 'react';
import { animate, stagger, spring, createAnimatable, createTimeline, utils } from 'animejs';

export const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    onComplete: () => utils.cleanInlineStyles?.(els),
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
    if (!el || !enabled || reduced) return;
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

export { animate, stagger, utils, createTimeline };
