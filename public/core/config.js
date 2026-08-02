// Point this at your deployed backend (e.g. a Render web service URL).
// Use "https://" - socket.io automatically upgrades to a secure "wss://"
// connection when the page/transport requires it, so you don't write "wss://" here.
//
// Leave SERVER_URL as an empty string to connect to whatever origin served
// this page (useful for local dev when the server also serves /public, e.g.
// http://localhost:2000).
const SERVER_URL = "https://pixel-fighter-2d-v2-0.onrender.com/";

export { SERVER_URL };
