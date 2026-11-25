# Fieldnotes

Fieldnotes is a public, read-only research notebook. Visitors can explore every topic and discussion without creating an account. Favorites and reading-list items are saved locally in the visitor's browser.

## Run locally

Requires Node.js 24 or newer.

```powershell
npm.cmd start
```

Open [http://localhost:3000](http://localhost:3000). Keep the terminal running while you use the site; closing the server causes `ERR_CONNECTION_REFUSED`. The public archive is stored in `public/topics.json`, and public discussion snapshots are stored in `public/discussions.json`.

Run the checks with:

```powershell
npm.cmd run check
npm.cmd test
```

## Deploy to Vercel

The deployed site is static and does not need a database, environment variables, or a Vercel server function. `vercel.json` selects the **Other** framework preset, disables the build command, and points Vercel to the `public` output directory.

1. Import this project into Vercel from your Git repository, or install the Vercel CLI and run `vercel` from the project directory.
2. Keep the framework preset as **Other** and the output directory as **public** (already configured).
3. Deploy. No build command or environment variables are required.

Favorites and bookmarks are per-browser and do not sync between devices. Discussions are public and read-only; to publish a discussion snapshot, update `public/discussions.json` in the repository and redeploy. The old SQLite-backed account and write APIs are not part of the Vercel static deployment.
