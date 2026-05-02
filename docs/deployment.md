# Deployment Notes

SightBridge currently has two deploy modes.

## Local Working Demo

Run:

```bash
python3 scripts/server.py
```

Then open:

```text
http://127.0.0.1:5173/public/
```

This mode supports:

- local macOS Vision OCR
- image upload analysis
- camera capture in external browsers that have camera permission
- fixture evaluation

## Public Working Web Demo

The deployed web version uses serverless cloud vision. Set this Vercel environment variable:

```text
ANTHROPIC_API_KEY=...
```

Optional:

```text
ANTHROPIC_VISION_MODEL=claude-sonnet-4-5
```

In production:

- local macOS Vision OCR is unavailable
- cloud vision is enabled when `ANTHROPIC_API_KEY` exists
- the UI asks before sending an image to Claude
- sample scans still run fully in the browser

## Vercel

Deploy from the repo root. Before deploy:

```bash
npm install
npm run deploy:check
```

Then configure `ANTHROPIC_API_KEY` in Vercel project settings.

The primary app is the Next.js app in `app/`. The older `public/index.html` prototype remains as a local reference and is served by `npm run local:ocr`.
