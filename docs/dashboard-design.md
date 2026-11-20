# Motteku Japan travel dashboard

The supplied dashboard reference guides the lavender shell, Japan travel hero, packing ring, pastel summaries, itinerary preview and quick actions. Existing trip data and Firebase configuration are preserved.

## Behavior

Search selects an existing trip by name or destination. Summary counts, dates and purchased-item spending come from the selected workspace trip. Weather uses the existing destination and trip-date APIs, labels preview coverage and guards against late responses. Quick actions open the corresponding real tabs. Itinerary supports adding, editing and removing activities within the trip dates. It is saved in the existing account workspace, or local browser workspace in demo mode; it is not a separate group-wide itinerary service.

## Artwork

Mode: built-in image_gen. PNG masters are retained in the generation folder. WebP copies are encoded with the existing Sharp dependency for delivery, with no content changes.

- public/images/japan-travel-hero.webp
- public/images/journey-cat.webp

Final hero prompt:

Use case: website-asset. Create a premium photorealistic wide 3:1 panoramic Japan travel hero background for a lavender travel-planner dashboard. Beautiful snow capped Mount Fuji in the center distance under a bright blue spring sky, red Japanese pagoda on the far right and blooming pink cherry blossoms framing the lower edge and upper right, lush foothills and an atmospheric Japanese valley. Leave left third calm with sky and distant hills, suitable for large white HTML title overlay. Crisp natural travel photography, soft sunny light, vibrant but refined blue and cherry pink tones. Entire output is only the landscape photo, no dashboard UI, no letters, no text, no logos, no watermark. This is decorative Japan travel imagery rather than a geographic representation of a particular trip destination.

Final cat prompt:

Asset type: wide website travel banner illustration, 3:1 composition. Create a charming kawaii cream and warm-brown kitten traveller sitting at the far right, winking and holding a small camera, wearing a teal backpack, cherry blossom petals and a soft hint of lavender Japanese hills around it. Pastel pink and lilac background with delicate sakura flowers in the corners. Leave the entire left half as clean softly shaded pastel negative space for live website text. Rounded friendly hand-painted illustration, polished travel stationery style, soft shadows, clear silhouette. Full banner artwork only, no website interface, no words, no lettering, no text, no watermark.

## Verification

TypeScript and production build passed. Browser checks covered desktop layout, live destination weather, activity creation and persistence after refresh. Firebase Rules were not changed by this redesign.
