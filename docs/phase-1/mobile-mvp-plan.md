# Phase 1 Mobile MVP Plan

## MVP Shape

SightBridge should become a phone-camera-first app before glasses integration. This keeps the first user testable version independent of Meta DAT, while preserving the future wearable architecture.

## User Flow

1. Open app to camera.
2. Capture frame.
3. Run local OCR.
4. Show disclosure summary:
   - severity
   - category
   - reason
   - processing path
5. User chooses:
   - Continue sharing
   - Restrict sharing
   - AI-only mode
   - Cancel

## Technical Milestones

1. Web MVP camera flow.
   - Browser camera capture now exists in `public/index.html`.
   - Local OCR endpoint exists in `scripts/server.py`.
2. Expo shell.
   - Initial source lives in `mobile/`.
   - Dependencies need installation when `npm` is available.
3. Native OCR.
   - iOS: Vision Framework.
   - Android: ML Kit.
4. Optional cloud vision.
   - Add only after an explicit consent screen.
   - Use it for blurry, non-text, or ambiguous cases.
5. Test suite.
   - Keep adding fixtures for false positives and misses.

## Go/No-Go Criteria

- Detects high-risk cards, prescriptions, IDs, addresses, and screens in controlled testing.
- Does not alert on common public content such as recipes, menus, product packaging, and bookshelves.
- User can understand what was detected and why.
- Processing path is always clear: local or cloud.
