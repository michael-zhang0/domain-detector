// Single place where the MediaPipe Tasks bundle and model URLs are pinned.
// Stage 1 (hands) and stage 3 (segmentation) share one WASM fileset, so they
// also share one download and one GPU context.

import {
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const SELFIE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let filesetPromise = null;

function vision() {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT);
  return filesetPromise;
}

export async function createHandLandmarker() {
  return HandLandmarker.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export async function createSegmenter() {
  return ImageSegmenter.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: SELFIE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}
