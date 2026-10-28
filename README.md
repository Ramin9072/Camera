# AI Pro Camera

Next.js (App Router) + strict TypeScript + Tailwind. Camera access, analysis and setting changes all run in the user's browser.

## Run locally
    npm install
    npm run dev
Open on a phone via HTTPS (e.g. `npx localtunnel --port 3000`, or deploy). `http://localhost` also works on desktop. Browsers require a secure context for the camera.

## Deploy to Vercel
1. Push this folder to a Git repository.
2. vercel.com → Add New → Project → import it (framework: Next.js, defaults are fine).
3. Optional: add `ANTHROPIC_API_KEY` (and `AI_MODEL`) in Project → Settings → Environment Variables. Without them the app works fully; the cloud classifier returns "not configured".
4. Deploy. Vercel serves HTTPS automatically.

## How it works
- `CameraManager` opens the stream, reads `getCapabilities()` / `getSettings()`, applies each constraint individually and only reports "applied ✓" when `getSettings()` shows the new value.
- `SceneAnalyzer` samples a 128×96 frame every 0.8 s: luminance, clipping, contrast, sharpness (Laplacian), frame-difference motion, colour ratios, backlight (centre vs edges), and faces if `FaceDetector` exists.
- `CameraRecommendationEngine` is deterministic: rules propose values, all are clamped to the camera's reported ranges/modes. Unsupported ones are shown as advice only. The cloud model can only pick a scene label from a fixed allow-list; it never emits camera values.

## Browser limitations (honest list)
- A website cannot drive the phone's native Pro camera app or use its lens/sensor modes.
- ISO, shutter, focus distance, white-balance temperature and exposure compensation are exposed mainly by Chrome on some Android devices; Safari/iOS exposes very little. Many phones expose none. The Pro panel shows only what the active track reports.
- Aperture is never controllable. RAW is not available. Capture may be limited to stream resolution when `ImageCapture.takePhoto` is unsupported (Safari, Firefox).
- Switching lenses (ultrawide/tele) works only if the browser lists them as separate video inputs.
- Scene detection is heuristic; food, pets, street and architecture need the manual override or the optional cloud classifier.
- Not tested on real devices; no compatibility claim is made.

## Native path
Keep `CameraRecommendationEngine` and `SceneAnalyzer`'s statistics as the portable spec (port to Kotlin/Swift or share via a small WASM/TS module).
- Android: CameraX + `Camera2Interop` (`SENSOR_SENSITIVITY`, `SENSOR_EXPOSURE_TIME`, `LENS_FOCUS_DISTANCE`, `CONTROL_AE_EXPOSURE_COMPENSATION`); read ranges from `CameraCharacteristics`; logical multi-camera IDs for lenses.
- iOS: `AVCaptureDevice.setExposureModeCustom(duration:iso:)`, `setFocusModeLocked(lensPosition:)`, `setWhiteBalanceModeLocked(with:)`, `setExposureTargetBias`, validated against `activeFormat` min/max.
