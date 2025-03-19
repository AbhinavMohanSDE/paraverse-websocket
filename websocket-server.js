const WebSocket = require('ws');
const http = require('http');

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create a WebSocket server by passing the HTTP server
const wss = new WebSocket.Server({ server });

// Connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');

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
const PORT = process.env.PORT || 8080;

// Start the server
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});