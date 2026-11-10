// Music files on a device get ids shaped like YouTube's, so they pass everywhere a video id does, but
// ending in Z. A YouTube id never ends in Z (its last character only carries four bits), so the two can
// never be confused.
export const isLocalId = (id) => typeof id === 'string' && id.length === 11 && id.endsWith('Z');
