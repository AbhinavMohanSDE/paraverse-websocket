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

// Track browser fingerprints to their user IDs
const browserToUser = new Map();

// Function to broadcast the current user list to all clients
function broadcastUserList() {
  try {
    // Only use browser fingerprints to determine unique users
    const activeUsers = [];
    const seenUserIds = new Set();
    
    // Collect unique users by browser fingerprint
    browserToUser.forEach((userData, fingerprint) => {
      if (!seenUserIds.has(userData.userId)) {
        seenUserIds.add(userData.userId);
        activeUsers.push({
          id: userData.userId,
          name: userData.userName
        });
      }
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
    
    console.log(`Broadcasted user list with ${activeUsers.length} unique browser fingerprints to all clients`);
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
      uptime: process.uptime(),
      uniqueUsers: browserToUser.size
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
  startTime: Date.now(),
  uniqueBrowsers: 0
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
  
  // Initialize connection metadata
  connectedClients.set(ws, {
    id: clientId,
    userId: null, // Will be set after identity is established
    browserFingerprint: null,
    ip: clientIp,
    origin: clientOrigin,
    connected: Date.now(),
    messages: 0
  });
  
  serverState.connections++;
  
  console.log(`Client ${clientId} connected from IP: ${clientIp}, Origin: ${clientOrigin}, Total: ${wss.clients.size}`);
  
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
      
      // Handle identity message with browser fingerprint
      if (parsedMessage.type === 'identity' && parsedMessage.browserFingerprint) {
        try {
          const browserFingerprint = parsedMessage.browserFingerprint;
          const providedUserId = parsedMessage.userId;
          const providedUserName = parsedMessage.userName;
          
          console.log(`Received identity with browser fingerprint: ${browserFingerprint}`);
          
          // Update client with the browser fingerprint
          if (client) {
            client.browserFingerprint = browserFingerprint;
          }
          
          // Check if this browser fingerprint already has a user
          const existingUserData = browserToUser.get(browserFingerprint);
          
          // If this browser fingerprint is known and has a user ID
          if (existingUserData) {
            // Update client with the existing user data
            if (client) {
              client.userId = existingUserData.userId;
            }
            
            // Send welcome message
            try {
              ws.send(JSON.stringify({
                type: 'welcome',
                message: 'Welcome back to Paraverse',
                id: clientId,
                userId: existingUserData.userId,
                userName: existingUserData.userName,
                timestamp: Date.now()
              }));
            } catch (error) {
              console.error('Error sending welcome message:', error);
            }
            
            console.log(`Recognized returning browser: ${browserFingerprint} as user: ${existingUserData.userId}, ${existingUserData.userName}`);
          } 
          // If this is a new browser or has a provided userId that needs to be stored
          else {
            // Generate or use the provided user data
            const userId = providedUserId || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const userName = providedUserName || generateUserName();
            
            // Store this data for the browser fingerprint
            browserToUser.set(browserFingerprint, {
              userId: userId,
              userName: userName,
              firstSeen: Date.now()
            });
            
            // Update the client with this user ID
            if (client) {
              client.userId = userId;
            }
            
            // Store user data
            users.set(userId, {
              id: userId,
              name: userName,
              ip: clientIp,
              origin: clientOrigin,
              connected: Date.now()
            });
            
            serverState.uniqueBrowsers = browserToUser.size;
            
            // Send welcome message
            try {
              ws.send(JSON.stringify({
                type: 'welcome',
                message: providedUserId ? 'Welcome back to Paraverse' : 'Connected to Paraverse WebSocket Server',
                id: clientId,
                userId: userId,
                userName: userName,
                timestamp: Date.now()
              }));
            } catch (error) {
              console.error('Error sending welcome message:', error);
            }
            
            console.log(`Registered new browser: ${browserFingerprint} as user: ${userId}, ${userName}`);
          }
          
          // Broadcast updated user list after identity is established
          broadcastUserList();
          return;
        } catch (error) {
          console.error('Error handling identity message:', error);
        }
      }
      
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
    connectedClients.delete(ws);
    
    // Only broadcast if we need to - check if any other connections exist for this browser
    let shouldBroadcast = true;
    
    if (clientData && clientData.browserFingerprint) {
      let browserStillConnected = false;
      
      // Check if any other connections are from this browser
      connectedClients.forEach((client) => {
        if (client.browserFingerprint === clientData.browserFingerprint) {
          browserStillConnected = true;
        }
      });
      
      // If the browser is no longer connected, we can remove it
      if (!browserStillConnected) {
        console.log(`Browser ${clientData.browserFingerprint} has no more connections`);
      } else {
        // Browser still has other connections, no need to update the user list
        console.log(`Browser ${clientData.browserFingerprint} still has other connections`);
        shouldBroadcast = false;
      }
    }
    
    // Broadcast the updated user list if needed
    if (shouldBroadcast) {
      broadcastUserList();
    }
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
  console.log(`[Health] Uptime: ${uptime}s, Clients: ${wss.clients.size}, Total connections: ${serverState.connections}, Messages: ${serverState.messages}, Errors: ${serverState.errors}, Unique browsers: ${browserToUser.size}`);
}, 60000);

// Cleanup interval - periodically check for zombie entries
setInterval(() => {
  const now = Date.now();
  const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
  
  // Check for browsers with no connections for more than threshold
  let browsersToPrune = [];
  
  browserToUser.forEach((userData, fingerprint) => {
    let hasActiveConnections = false;
    
    // Check if any connections exist for this browser
    connectedClients.forEach((client) => {
      if (client.browserFingerprint === fingerprint) {
        hasActiveConnections = true;
      }
    });
    
    // If no active connections and data is old, mark for pruning
    if (!hasActiveConnections && userData.lastActivity && (now - userData.lastActivity > INACTIVE_THRESHOLD)) {
      browsersToPrune.push(fingerprint);
    }
  });
  
  // Prune inactive browser entries
  browsersToPrune.forEach(fingerprint => {
    const userData = browserToUser.get(fingerprint);
    console.log(`Pruning inactive browser: ${fingerprint}, User: ${userData.userName}`);
    browserToUser.delete(fingerprint);
  });
  
  if (browsersToPrune.length > 0) {
    console.log(`Pruned ${browsersToPrune.length} inactive browser entries`);
    broadcastUserList();
  }
}, 3600000); // Run every hour