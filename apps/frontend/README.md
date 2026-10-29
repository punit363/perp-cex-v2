# APEX Exchange frontend

The landing page uses Bun, React, and Tailwind. It connects to the backend's
authentication and balance endpoints at `http://localhost:8000/api/v1` during
local development.

From the repository root, install dependencies with `bun install`. Start the
backend on port 8000, then run the frontend from this directory:

```sh
bun dev
```

Check and build with:

```sh
bun check
bun run build
```

Sign-in sessions are held in memory for the current page. The landing page
does not display invented market volume or latency values.
