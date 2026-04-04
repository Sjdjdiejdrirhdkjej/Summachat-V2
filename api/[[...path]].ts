import app from "../artifacts/api-server/src/app";

// Catch all /api requests on Vercel so nested routes like /api/multi-chat
// resolve through the Express app instead of depending on a rewrite to /api/index.

export default app;
