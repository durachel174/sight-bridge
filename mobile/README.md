# SightBridge Mobile MVP

This folder is the app target for the next build. The current machine does not have `npm` available, so dependencies are not installed yet, but the source is structured for an Expo/React Native MVP.

## Target Flow

1. Camera opens first.
2. User captures a frame.
3. App runs local OCR where available.
4. App shows a calm disclosure alert.
5. User chooses Continue, Restrict, AI-only, or Cancel.
6. Cloud vision is opt-in and must explain that the image leaves the device.

## Suggested Setup

When Node/npm are available:

```bash
cd mobile
npm install
npm run start
```

## Next Native Work

- Add `expo-camera`
- Add native OCR layer:
  - iOS Vision Framework
  - Android ML Kit
- Reuse the disclosure engine logic from `../src/engine`
- Add an explicit cloud-analysis permission screen
