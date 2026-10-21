// Kept separate from auth.ts so the proxy can read the cookie name without
// importing the database client.
export const SESSION_COOKIE = "ap_session";
