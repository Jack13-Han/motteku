# Motteku — Group Trip Planner MVP

A runnable Next.js prototype for the Motteku school project. It includes trip templates, packing statuses, member management, auto-assignment of unassigned items, item weights/comments/prices, budget tracking, expense split summaries, trip history/copy, CSV export, Open-Meteo weather, and optional Gemini advice.

## Requirements
- Node.js 20.9+ (recommended)
- npm

## Run locally (demo mode)
1. Extract the ZIP.
2. Open a terminal in the `motteku-app` folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env.local` (optional for demo mode; you can skip this).
5. Run `npm run dev`.
6. Open http://localhost:3000.

Demo mode stores data in your browser's localStorage. It does not sync between different browsers/devices. The weather and built-in advice can be tested without Firebase. Gemini AI requires a server-side API key.

## Enable Firebase cloud storage/sync
1. Create a project at https://console.firebase.google.com/.
2. Add a Web App and copy its Firebase config into `.env.local` using the `NEXT_PUBLIC_FIREBASE_...` names from `.env.example`.
3. In Firebase Authentication → Sign-in method, enable **Anonymous** sign-in.
4. Create a Cloud Firestore database.
5. In Firestore Rules, paste the contents of `firestore.rules` and publish.
6. Restart the dev server (`Ctrl+C`, then `npm run dev`).

This prototype stores the signed-in anonymous user's workspace at `users/{uid}/workspace/main`. The included rules restrict each user's workspace to that user's UID. For real multi-member sharing, implement explicit trip membership and more granular security rules before production; this MVP's anonymous workspace is not a complete shared-trip invitation system.

## Enable Gemini AI advice (optional)
1. Get an API key from https://aistudio.google.com/apikey.
2. Add to `.env.local`:
   `GEMINI_API_KEY=your_key_here`
3. Optionally set `GEMINI_MODEL=gemini-2.5-flash` (or a model available to your account).
4. Restart the dev server.

Never expose the Gemini key in a `NEXT_PUBLIC_` variable or commit `.env.local` to Git.

## Weather
The server route calls Open-Meteo. The UI geocodes the city entered in the trip destination and displays a seven-day forecast. Forecast availability may not cover the full trip date range.

## Current prototype limitations
- Expense entries are held in page state and are not yet persisted with the trip workspace or shared with other devices.
- Firebase sync uses one anonymous user's workspace; real invite links, multi-user access, and member roles are future work.
- Receipt image upload is not implemented yet; `receiptUrl` is reserved in the item data model.
- Notifications, push reminders, and full chat are not implemented. Item comments are available in the packing list.
- This is a school-project MVP, not a production-ready service. Add tests, validation, rate limiting, and production security review before deployment.

## Build check
Run `npm run build` to check the production build. If npm reports package peer-dependency or network errors, confirm Node.js/npm versions and retry `npm install`.
