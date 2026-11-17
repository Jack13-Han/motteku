# Motteku bag photo update

## What changed

- Bag photos store a Firebase Storage object path in the shared bag plan. Older Firebase download URLs are normalized when read.
- Cloud photos download through the Firebase SDK and display using temporary browser object URLs. Local demo photos continue to use data URLs.
- Loading and download failures have separate translated labels. Temporary URLs are released when photos change or the component unmounts.
- Bag verification and location edits keep the current photo instead of triggering another download.

## Notes

- This merge updates the bag photo component. The dashboard page and global styles have no changes relative to the merge base.
- Existing packing, budget, weather, chat, reminders, members and history flows retain their current data.
- Cloud downloads require an existing Storage bucket, member access allowed by Storage Rules, and bucket CORS allowing the website's origin. Follow the [Firebase CORS setup documentation](https://firebase.google.com/docs/storage/web/download-files#cors_configuration). Configure the origins used by your app, including localhost when developing.
- Local component tests mock Storage transport. They do not verify the deployed bucket, CORS or real-account image access.
- Keep your own `.env.local` values; no project credentials are included in this change.

## Run on Windows

```bash
npm install
npm run dev
```

Then open http://localhost:3000.
