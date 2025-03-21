const WebSocket = require('ws');
const http = require('http');

// Store user data with unique identifiers and names
const users = new Map();
const adjectives = [
  "Swift", "Brave", "Mighty", "Noble", "Clever", "Bright", "Quick", "Epic", 
  "Cosmic", "Mystic", "Golden", "Silver", "Crystal", "Shadow", "Royal",
  "Stellar", "Hyper", "Super", "Mega", "Ultra", "Alpha", "Omega", "Neo"
];
const nouns = [
  "Warrior", "Knight", "Explorer", "Wizard", "Rogue", "Guardian", "Hunter", 
  "Voyager", "Scholar", "Pioneer", "Champion", "Hero", "Captain", "Ace",
  "Ranger", "Pilot", "Agent", "Commander", "Ninja", "Samurai", "Phoenix"
];

// Generate a unique name for a user
function generateUserName() {
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 100);
  return `${randomAdj}${randomNoun}${randomNumber}`;
}

// Function to broadcast the current user list to all clients
function broadcastUserList() {
  try {
    // Create array of user objects from active connections
    const activeUsers = Array.from(connectedClients.entries()).map(([socket, client]) => {
      const userData = users.get(client.userId) || { id: client.userId, name: 'Unknown User' };
      return {
        id: userData.id,
        name: userData.name
      };
    });
    
    // Create the message once
    const message = JSON.stringify(activeUsers);
    
    // Send to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error sending user list to client:', error);
        }
      }
    });
    
    console.log(`Broadcasted user list with ${activeUsers.length} users to all clients`);
  } catch (error) {
    console.error('Error broadcasting user list:', error);
  }
}

// Create HTTP server with better response
const server = http.createServer((req, res) => {
  // Set CORS headers to allow connections from client domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle OPTIONS requests for CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Explicitly handle WebSocket upgrade path
  if (req.url === '/ws' || req.url === '/') {
    // For GET requests to the WebSocket endpoint, provide a helpful message
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      message: 'WebSocket server is running. Connect via WebSocket protocol.',
      connections: wss?.clients?.size || 0,
      uptime: process.uptime()
    }));
    return;
  }
  
  // For any other path, return a 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    message: 'The requested resource was not found. WebSocket connections should be made to the root path.',
    url: req.url
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
  
  // Generate a unique user ID and name
  const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const userName = generateUserName();
  
  // Store user data
  users.set(userId, {
    id: userId,
    name: userName,
    ip: clientIp,
    origin: clientOrigin,
    connected: Date.now()
  });
  
  // Track client connection
  connectedClients.set(ws, {
    id: clientId,
    userId: userId,
    ip: clientIp,
    origin: clientOrigin,
    connected: Date.now(),
    messages: 0
  });
  
  serverState.connections++;
  
  console.log(`Client ${clientId} connected from IP: ${clientIp}, Origin: ${clientOrigin}, User: ${userName}, Total: ${wss.clients.size}`);
  
  // Send welcome message to client
  try {
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Paraverse WebSocket Server',
      id: clientId,
      userId: userId,
      userName: userName,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
  
  // Broadcast the updated user list to all clients
  broadcastUserList();
  
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
      
      // Handle getUsers request
      if (parsedMessage.type === 'getUsers') {
        try {
          // Broadcast to all clients instead of just responding to this one
          broadcastUserList();
          return;
        } catch (error) {
          console.error('Error handling getUsers request:', error);
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
    
    // Get the client data
    const clientData = connectedClients.get(ws);
    if (clientData && clientData.userId) {
      // Check if this userId is used by any other connections
      let userIsStillConnected = false;
      connectedClients.forEach((client) => {
        if (client.userId === clientData.userId && client.id !== clientData.id) {
          userIsStillConnected = true;
        }
      });
      
      // Only remove user data if no other connections are using it
      if (!userIsStillConnected) {
        users.delete(clientData.userId);
        console.log(`Removed user ${clientData.userId} from users list`);
      }
    }
    
    connectedClients.delete(ws);
    
    // Broadcast the updated user list after removing the client
    broadcastUserList();
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
  console.log(`[Health] Uptime: ${uptime}s, Clients: ${wss.clients.size}, Total connections: ${serverState.connections}, Messages: ${serverState.messages}, Errors: ${serverState.errors}, Users: ${users.size}`);
}, 60000);