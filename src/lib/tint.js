// The background takes on the colour of the cover that's playing (desktop only). One small sample of
// the cover is averaged, its brightest, most colourful pixels weighted up, and the result is pushed
// toward the app's own saturation so a grey cover still gives a soft violet rather than mud.
import { IS_ANDROID } from './platform.js';

const FALLBACK = '#5b21b6';
const SIZE = 16;
const cache = new Map();

function sample(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = SIZE;
        c.height = SIZE;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, SIZE, SIZE);
        const d = g.getImageData(0, 0, SIZE, SIZE).data;
        let r = 0; let gr = 0; let b = 0; let w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const weight = 0.2 + (max - min) / 255 + max / 510;
          r += d[i] * weight; gr += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
        }
        resolve(w ? tone(r / w, gr / w, b / w) : null);
      } catch { resolve(null); } // a cover served without CORS can't be read
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Keep the hue, settle saturation and lightness where the app's own glows sit.
function tone(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  let h = 0;
  const d = max - min;
  if (d > 0.0001) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
  }
  const s = d < 0.08 ? 0.45 : Math.min(0.85, Math.max(0.55, d / (1 - Math.abs(2 * l - 1) || 1)));
  return `hsl(${Math.round((h + 360) % 360)} ${Math.round(s * 100)}% 42%)`;
}

let last = null;
export async function tintFrom(src) {
  if (IS_ANDROID || !src || src === last) return;
  last = src;
  if (!cache.has(src)) cache.set(src, sample(src));
  const color = await cache.get(src);
  if (last !== src) return;
  document.documentElement.style.setProperty('--tint', color || FALLBACK);
}
