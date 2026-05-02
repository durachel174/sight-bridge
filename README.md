# SightBridge

SightBridge is a disclosure-awareness layer for AI glasses and phone-camera visual assistance. The Phase 1 thesis is simple: before any camera content leaves the user, the system should explain what sensitive information may be visible and let the user decide what happens next.

This repo starts the project with a dependency-light browser prototype and a testable sensitivity engine. It is intentionally phone-camera/web first so Phase 0 can validate the core product without waiting on glasses SDK feasibility.

## What Is Included

- A runnable prototype in `public/index.html`
- A local OCR/rule layer for PII and sensitive keywords
- A contextual classifier stub that mirrors the future multimodal API contract
- Image upload with local macOS Vision OCR through the local server
- Merge logic for high, medium, low, and uncertain disclosure decisions
- Scenario fixtures from the handoff document
- Phase 0 plan and user-research script
- Node test coverage for the engine behavior

## Run The Web App

Install dependencies, then run the Next.js app:

```bash
npm install
npm run dev
```

The production web app uses Claude cloud vision through the Next/Vercel API route when `ANTHROPIC_API_KEY` is configured.

## Run Legacy Local OCR Prototype

```bash
npm run local:ocr
```

Then open `http://127.0.0.1:5173/public/`.

## Test

```bash
npm test
```

## Phase 0 Priorities

1. Validate whether users want disclosure alerts through 8-12 interviews.
2. Measure detection quality against the 15 scenario matrix.
3. Decide whether the first build should target Meta glasses or phone-camera-first.
4. Replace the contextual classifier stub with a real vision model call once an API/provider is chosen.

## Current Image Upload Behavior

Image upload now sends the selected image to the local SightBridge server, runs macOS Vision OCR locally, and feeds extracted text into the disclosure engine. This is text-focused OCR, not full contextual scene classification yet.

The integration point is `src/engine/imageAnalyzer.js`. Full contextual image classification can be added there after the Phase 0 provider choice.

## Optional Cloud Vision

Cloud vision assist is wired but disabled by default in deployment until an API key is configured:

```bash
ANTHROPIC_API_KEY=...
```

When enabled, the UI still asks before sending any selected image to Claude. Local OCR remains available only in the legacy local prototype.

## Deployment

See `docs/deployment.md`. The real web app is now a Next.js app in `app/`. Public deployment uses the Next/Vercel serverless Claude vision route when `ANTHROPIC_API_KEY` is configured.

## Project Shape

```text
docs/
  phase-0/             Research and feasibility planning
  research/            Interview script and synthesis notes
fixtures/              Scenario matrix and test inputs
public/                Static browser entrypoint
src/
  app/                 Prototype UI
  engine/              Sensitivity detection and merge logic
  styles/              Prototype styling
tests/                 Node test suite
```
