// YouTube's 4:3 video pictures (hqdefault, sddefault, default, 0 to 3) put the 16:9 frame between black
// bars. Where a cover is drawn as a background, which CSS can't crop by picture size, mqdefault stands in:
// the same frame without the bars. Images (<img>) keep their sharper picture and are cropped in
// components.css instead.
const BARRED = /^(https:\/\/i\.ytimg\.com\/vi)(?:_webp)?(\/[\w-]+\/)(?:hqdefault|sddefault|default|hq[1-3]|sd[1-3]|[0-3])(?:_live)?\.(?:jpg|webp)(?:\?.*)?$/;

export function barFree(url) {
  return typeof url === 'string' ? url.replace(BARRED, '$1$2mqdefault.jpg') : url;
}
