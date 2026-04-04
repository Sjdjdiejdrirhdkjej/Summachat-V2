import app from "../artifacts/api-server/dist/app.mjs";

// Catch all /api requests on Vercel so nested routes like /api/multi-chat
// resolve through the Express app instead of depending on a rewrite to /api/index.
//
// This imports the pre-built output (dist/app.mjs) rather than raw TypeScript
// because Vercel's @vercel/node runtime compiles with moduleResolution: "node16"
// which requires explicit file extensions and is incompatible with the project's
// "bundler" resolution used everywhere else.

export default app;
