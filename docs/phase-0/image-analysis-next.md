# Image Analysis Next Step

The current prototype analyzes text, scenario fixtures, and uploaded images via local macOS Vision OCR. This covers text visible in images, but not full contextual scene understanding yet.

## Recommended Integration Order

1. Keep local OCR as the first pass for privacy and speed.
2. Pattern match on extracted OCR text using the existing local engine.
3. Add selective multimodal vision only when context is ambiguous or high risk.
4. Disclose whether processing is local or cloud-based before production sharing.

## Adapter Contract

`src/engine/imageAnalyzer.js` should return:

```js
{
  available: true,
  text: "OCR text extracted from image",
  message: "Processed locally with device OCR."
}
```

If a cloud model is used, the `message` should name the processing path clearly before any production sharing flow.
