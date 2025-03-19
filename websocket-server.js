const WebSocket = require('ws');
const http = require('http');

// Create an HTTP server
const server = http.createServer((req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create a WebSocket server with CORS handling
const wss = new WebSocket.Server({ 
  server,
  // Add CORS handling
  verifyClient: (info, done) => {
    const origin = info.req.headers.origin;
    const allowedOrigins = [
      'https://paraverse.games', // Your main domain
      'https://www.paraverse.games', // Optional: with www
      'http://localhost:3000', // Local development
      'http://localhost:8080'  // Alternative local development port
    ];
    
    const isAllowed = !origin || allowedOrigins.includes(origin);
    console.log(`Connection attempt from origin: ${origin}, Allowed: ${isAllowed}`);
    done(isAllowed);
  }
});

// Connection handler
wss.on('connection', (ws, req) => {
  const clientOrigin = req.headers.origin || 'Unknown';
  console.log(`Client connected from origin: ${clientOrigin}`);

  // Message handler
  ws.on('message', (message) => {
    console.log('Received:', message.toString());
   
    try {
      const parsedMessage = JSON.parse(message);
     
      // Broadcast the message to all connected clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(parsedMessage));
        }
      });
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  // Close handler
  ws.on('close', () => {
    console.log('Client disconnected');
  });

  // Error handler
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Get port from environment or use default
const PORT = process.env.PORT || 10000;

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
});