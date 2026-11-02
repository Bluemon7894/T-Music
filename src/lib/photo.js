// A picture someone picked, made small enough to travel with their name. There's no file storage here, so
// it's written where the name is, and every room and friend list that holds the name holds this too.
import { MAX_PHOTO } from './safeTrack.js';

const ATTEMPTS = [[192, 0.82], [192, 0.6], [128, 0.7], [96, 0.6]];

export async function photoFromFile(file) {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  try {
    for (const [size, quality] of ATTEMPTS) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const draw = canvas.getContext('2d');
      draw.fillStyle = '#1a1130'; // what a transparent picture sits on
      draw.fillRect(0, 0, size, size);
      draw.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_PHOTO) return url;
    }
  } finally {
    image.close();
  }
  throw new Error('picture too detailed');
}
