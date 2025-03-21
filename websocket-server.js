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
    // Get unique active users by connection
    const uniqueUserIds = new Set();
    const uniqueUsers = [];
    
    // First collect all unique user IDs that are currently connected
    connectedClients.forEach((client) => {
      if (client.userId && !uniqueUserIds.has(client.userId)) {
        uniqueUserIds.add(client.userId);
        uniqueUsers.push({
          id: client.userId,
          name: users.get(client.userId)?.name || 'Unknown User'
        });
      }
    });
    
    // Create the message once
    const message = JSON.stringify(uniqueUsers);
    
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
    
    console.log(`Broadcasted user list with ${uniqueUsers.length} unique users to all clients`);
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
  
  // We'll wait for identity information before assigning a user
  let userId = null;
  let userName = null;
  let isReturningUser = false;
  
  // Initialize connection but don't assign a user yet
  connectedClients.set(ws, {
    id: clientId,
    userId: null, // Will be set after identity is established
    ip: clientIp,
    origin: clientOrigin,
    connected: Date.now(),
    messages: 0
  });
  
  serverState.connections++;
  
  console.log(`Client ${clientId} connected from IP: ${clientIp}, Origin: ${clientOrigin}, Total: ${wss.clients.size}`);
  
  // Message handler - we'll process messages before sending the welcome
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
      
      // Handle identity message (client sending persistent user ID)
      if (parsedMessage.type === 'identity' && parsedMessage.userId && parsedMessage.userName) {
        try {
          const providedUserId = parsedMessage.userId;
          const providedUserName = parsedMessage.userName;
          
          console.log(`Received identity for user: ${providedUserId}, ${providedUserName}`);
          
          // Check if this is an existing user
          const existingUser = users.get(providedUserId);
          
          if (existingUser) {
            // This is a returning user
            userId = providedUserId;
            userName = existingUser.name;
            isReturningUser = true;
            
            // Update the client with the existing user ID
            if (client) {
              client.userId = providedUserId;
              
              // Update the connected timestamp
              existingUser.connected = Date.now();
              existingUser.ip = clientIp; // Update IP in case it changed
              
              console.log(`Restored existing user: ${providedUserId}, ${existingUser.name}`);
            }
          } else {
            // This is a new user with a client-generated ID
            userId = providedUserId;
            userName = providedUserName;
            
            users.set(providedUserId, {
              id: providedUserId,
              name: providedUserName,
              ip: clientIp,
              origin: clientOrigin,
              connected: Date.now()
            });
            
            // Update client with the provided ID
            if (client) {
              client.userId = providedUserId;
              console.log(`Created new user with provided ID: ${providedUserId}, ${providedUserName}`);
            }
          }
          
          // Now send the welcome message with the correct user info
          try {
            ws.send(JSON.stringify({
              type: 'welcome',
              message: isReturningUser ? 'Welcome back to Paraverse' : 'Connected to Paraverse WebSocket Server',
              id: clientId,
              userId: userId,
              userName: userName,
              timestamp: Date.now()
            }));
          } catch (error) {
            console.error('Error sending welcome message:', error);
          }
          
          // Broadcast updated user list after identity is established
          broadcastUserList();
          return;
        } catch (error) {
          console.error('Error handling identity message:', error);
        }
      }
      
      // If we got this far and still don't have a user ID, generate one
      if (!userId && client && !client.userId) {
        // Generate a unique ID and name for this user
        userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        userName = generateUserName();
        
        // Store user data
        users.set(userId, {
          id: userId,
          name: userName,
          ip: clientIp,
          origin: clientOrigin,
          connected: Date.now()
        });
        
        // Update client with the new user ID
        client.userId = userId;
        
        // Send welcome with new user info
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
        
        // Broadcast updated user list
        broadcastUserList();
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

// Cleanup interval - remove users that haven't been connected in a while
setInterval(() => {
  // Count how many actual connected clients we have for each user
  const userConnections = new Map();
  
  connectedClients.forEach((client) => {
    if (client.userId) {
      const count = userConnections.get(client.userId) || 0;
      userConnections.set(client.userId, count + 1);
    }
  });
  
  // Remove users with no active connections
  users.forEach((user, userId) => {
    if (!userConnections.has(userId)) {
      console.log(`Removing disconnected user ${userId}`);
      users.delete(userId);
    }
  });
}, 300000); // Every 5 minutes