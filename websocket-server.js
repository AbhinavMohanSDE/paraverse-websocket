const WebSocket = require('ws');
const http = require('http');
const https = require('https');

// Create an HTTP/HTTPS server
const server = http.createServer((req, res) => {
  // Add comprehensive CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create a WebSocket server with enhanced CORS handling
const wss = new WebSocket.Server({ 
  server,
  // Detailed CORS and connection verification
  verifyClient: (info, done) => {
    const origin = info.req.headers.origin;
    const allowedOrigins = [
      'https://paraverse.games',
      'https://www.paraverse.games',
      'http://localhost:3000',
      'http://localhost:8080'
    ];
    
    console.log(`Connection attempt from origin: ${origin}`);
    const isAllowed = !origin || allowedOrigins.some(allowed => 
      origin.includes(allowed)
    );
    
    console.log(`Connection ${isAllowed ? 'ALLOWED' : 'REJECTED'}`);
    done(isAllowed);
  }
});

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const clientOrigin = req.headers.origin || 'Unknown';
  
  console.log(`Client connected from IP: ${clientIp}, Origin: ${clientOrigin}`);

  // Message handler
  ws.on('message', (message) => {
    console.log('Received raw message:', message.toString());
   
    try {
      const parsedMessage = JSON.parse(message);
      console.log('Parsed message:', parsedMessage);
     
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
    console.log(`Client disconnected from IP: ${clientIp}`);
  });

  // Error handler
  ws.on('error', (error) => {
    console.error(`WebSocket error from IP ${clientIp}:`, error);
  });
});

// Error handling for the server
server.on('error', (error) => {
  console.error('HTTP Server Error:', error);
});

// Get port from environment or use default
const PORT = process.env.PORT || 10000;

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`Environment PORT: ${process.env.PORT}`);
});