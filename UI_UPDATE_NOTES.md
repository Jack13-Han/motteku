# Motteku UI update

## What changed

- `app/page.tsx`: Rebuilt the Overview tab as a responsive travel dashboard inspired by the supplied purple Japan travel mockup. The trip name, destination, dates, packing counts, budget, and member list use the existing trip/workspace state. Dashboard quick actions navigate to the existing Packing list, Budget, Weather & AI, Group chat, and Members sections.
- `app/globals.css`: Added the refreshed lavender/pastel dashboard theme, hero banner, progress ring, summary tiles, itinerary preview, quick-action cards, and responsive layouts. Existing styles for the other pages and components remain in place.

## Notes

- The three itinerary rows on the Overview page are visual sample previews, not saved itinerary records. The current project does not yet have a persisted itinerary activity model.
- Existing Firebase/local demo storage, packing, budget, weather, chat, reminders, members, and history components were not replaced.
- `.env.local`, `.git`, and `node_modules` are intentionally excluded from this ZIP. Keep your own `.env.local` file safe and copy it into the extracted project if you use Firebase or optional API keys.

## Run on Windows

```bash
npm install
npm run dev
```

Then open http://localhost:3000.
