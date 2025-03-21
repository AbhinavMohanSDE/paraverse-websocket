const WebSocket = require('ws');
const http = require('http');

// Create an HTTP server
const server = http.createServer((req, res) => {
  // Add comprehensive CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  
  // Handle OPTIONS requests for CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Return server status as JSON for better debugging
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    message: 'WebSocket server is running',
    clients: wss ? wss.clients.size : 0,
    uptime: process.uptime()
  }));
});

// Create a WebSocket server with improved CORS handling
const wss = new WebSocket.Server({
  server,
  // More permissive verification to help with debugging
  verifyClient: (info, done) => {
    const origin = info.req.headers.origin || 'unknown';
    const allowedOrigins = [
      'https://paraverse.games',
      'https://www.paraverse.games',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://localhost:3000',
      'https://127.0.0.1:3000'
    ];
    
    // Log all connection attempts
    console.log(`Connection attempt from origin: ${origin}`);
    
    // More permissive check for development
    let isAllowed = true;
    
    // In production, be more strict but still allow common scenarios
    if (process.env.NODE_ENV === 'production') {
      isAllowed = origin === 'unknown' || // Allow unknown origins (for testing)
                 allowedOrigins.includes(origin) || // Exact match
                 origin.endsWith('paraverse.games'); // Any subdomain
    }
    
    console.log(`Connection ${isAllowed ? 'ALLOWED' : 'REJECTED'}`);
    done(isAllowed);
  }
});

// Track connected clients
const connectedClients = new Map();

// Server state for reporting
const serverState = {
  connections: 0,
  messages: 0,
  errors: 0,
  startTime: Date.now()
};

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  serverState.errors++;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  serverState.errors++;
});

// Connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const clientOrigin = req.headers.origin || 'Unknown';
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  // Track client
  connectedClients.set(ws, {
    id: clientId,
    ip: clientIp,
    origin: clientOrigin,
    connected: Date.now(),
    messages: 0
  });
  
  serverState.connections++;
  
  console.log(`Client connected from IP: ${clientIp}, Origin: ${clientOrigin}, Total: ${wss.clients.size}`);
  
  // Send welcome message to client
  try {
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Paraverse WebSocket Server',
      id: clientId,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
  
  // Message handler
  ws.on('message', (message) => {
    try {
      const msgStr = message.toString();
      console.log(`Received message from ${clientId}:`, msgStr.substring(0, 100) + (msgStr.length > 100 ? '...' : ''));
      
      // Update client stats
      const client = connectedClients.get(ws);
      if (client) {
        client.messages++;
        client.lastActivity = Date.now();
      }
      
      serverState.messages++;
      
      const parsedMessage = JSON.parse(msgStr);
      
      // Handle ping-pong specially
      if (parsedMessage.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        } catch (error) {
          console.error('Error sending pong:', error);
        }
      }
      
      // Broadcast the message to all connected clients (except sender)
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(msgStr);
          } catch (error) {
            console.error('Error broadcasting message:', error);
          }
        }
      });
    } catch (error) {
      serverState.errors++;
      console.error('Error handling message:', error);
    }
  });
  
  // Close handler
  ws.on('close', (code, reason) => {
    console.log(`Client ${clientId} disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    connectedClients.delete(ws);
  });
  
  // Error handler
  ws.on('error', (error) => {
    serverState.errors++;
    console.error(`WebSocket error for client ${clientId}:`, error);
  });
});

// Error handling for the server
server.on('error', (error) => {
  serverState.errors++;
  console.error('HTTP Server Error:', error);
});

// Get port from environment or use default
const PORT = process.env.PORT || 8080;

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Environment PORT: ${process.env.PORT || 'not set, using default'}`);
});

// Health check interval - logs server status every minute
setInterval(() => {
  const uptime = Math.floor((Date.now() - serverState.startTime) / 1000);
  console.log(`[Health] Uptime: ${uptime}s, Clients: ${wss.clients.size}, Total connections: ${serverState.connections}, Messages: ${serverState.messages}, Errors: ${serverState.errors}`);
}, 60000);