// Bumped whenever web fonts finish loading: a raster or a measurement made before is stale. Kept in its own tiny
// module so the title code (measurer, spec caches) and the compositor share one counter without importing each other.

let epoch = 0
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener?.('loadingdone', () => { epoch++; if (typeof window !== 'undefined') window.dispatchEvent(new Event('esb:video-media-ready')) })
}

export const fontEpochNow = () => epoch
