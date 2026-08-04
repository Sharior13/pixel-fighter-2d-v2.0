const express = require('express');
const cors = require('cors');
const { createServer} = require('node:http');
const { Server } = require('socket.io');

const { socketHandler } = require('./networking/socketHandler.js');
const { debugLog } = require("./core/debug.js");

// Render (and most hosts) inject PORT at runtime - always defer to it, falling
// back to 2000 for local dev.
const port = process.env.PORT || 2000;

// Comma-separated list of allowed origins, e.g.
//   CLIENT_ORIGIN=https://your-frontend.example.com,https://another-frontend.example.com
// Falls back to allowing everything so local dev / same-origin deployments keep working
// out of the box - set CLIENT_ORIGIN in production to lock this down.
const allowedOrigins = process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(',').map(origin => origin.trim())
    : true; // true = reflect request origin (any origin allowed)

const corsOptions = {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
};

const app = express();
const server = createServer(app);

// Express CORS - needed for any plain HTTP requests (static assets, health checks, etc.)
app.use(cors(corsOptions));

// Socket.io CORS - this is the one that actually matters for the WSS handshake
// once the client lives on a different origin than the server.
const io = new Server(server, {
    pingInterval: 5000,
    pingTimeout: 20000,
    autoConnect: false,
    cors: corsOptions,
});

// This server no longer serves the frontend - public/ is deployed separately
// as a static site. These routes exist only so Render's health check (and any
// uptime pinger hitting "/") gets a real 200 instead of a 404.
app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'pixel-fighter-2d backend' });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

//handle socket events
socketHandler(io);


server.listen(port, ()=>{
    debugLog(`Server running on port ${port}`);
});