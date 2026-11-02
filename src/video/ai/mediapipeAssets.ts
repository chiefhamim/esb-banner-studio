// Where the bundled MediaPipe runtime and models are. Relative to the page, never "/…": the desktop app loads the page
// from a file, so a root-absolute path would point at the drive root. (Dev server: the same folders under /public.)
const rel = (p: string) => new URL(p, document.baseURI).href

export const mediapipeWasmDir = () => rel('mediapipe/wasm')
export const mediapipeModel = (file: 'blaze_face_short_range.tflite' | 'selfie_segmenter.tflite') => rel(`models/mediapipe/${file}`)
