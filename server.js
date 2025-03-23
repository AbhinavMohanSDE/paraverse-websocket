const WebSocket = require('ws');
const http = require('http');
const UserManager = require('./managers/UserManager');
const ClientManager = require('./managers/ClientManager');
const ChatManager = require('./managers/ChatManager');
const ServerState = require('./utils/ServerState');
const { setupErrorHandlers } = require('./utils/ErrorHandlers');

// Create main server class
class WebSocketServer {
  constructor(port = process.env.PORT || 8080) {
    this.port = port;
    
    // Create managers
    this.userManager = new UserManager();
    this.serverState = new ServerState();
    this.clientManager = new ClientManager(this.userManager, this.serverState);
    this.chatManager = new ChatManager();
    
    // Create HTTP server
    this.server = this.createHttpServer();
    
    // Create WebSocket server
    this.wss = this.createWebSocketServer();
    
    // Setup error handlers
    setupErrorHandlers(this.serverState);
    
    // Setup health checks and cleanup
    this.setupIntervals();
  }
  
  createHttpServer() {
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
          connections: this.wss?.clients?.size || 0,
          uptime: process.uptime(),
          uniqueUsers: this.userManager.getBrowserCount()
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
    
    // Error handling for the server
    server.on('error', (error) => {
      this.serverState.incrementErrors();
      console.error('HTTP Server Error:', error);
    });
    
    return server;
  }
  
  createWebSocketServer() {
    // Create a WebSocket server with improved CORS handling
    const wss = new WebSocket.Server({
      server: this.server,
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
    
    // Set up connection handler
    wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    
    return wss;
  }
  
  handleConnection(ws, req) {
    const clientIp = req.socket.remoteAddress;
    const clientOrigin = req.headers.origin || 'Unknown';
    
    // Register client with client manager
    const clientId = this.clientManager.registerClient(ws, clientIp, clientOrigin);
    this.serverState.incrementConnections();
    
    console.log(`Client ${clientId} connected from IP: ${clientIp}, Origin: ${clientOrigin}, Total: ${this.wss.clients.size}`);
    
    // Set up message handler
    ws.on('message', (message) => this.handleMessage(ws, message, clientId));
    
    // Set up close handler
    ws.on('close', (code, reason) => this.handleClose(ws, code, reason, clientId));
    
    // Set up error handler
    ws.on('error', (error) => {
      this.serverState.incrementErrors();
      console.error(`WebSocket error for client ${clientId}:`, error);
    });
  }
  
  handleMessage(ws, message, clientId) {
    try {
      const msgStr = message.toString();
      console.log(`Received message from ${clientId}:`, msgStr.substring(0, 100) + (msgStr.length > 100 ? '...' : ''));
      
      // Update client activity
      this.clientManager.updateClientActivity(ws);
      this.serverState.incrementMessages();
      
      const parsedMessage = JSON.parse(msgStr);
      
      // Handle identity message with browser fingerprint
      if (parsedMessage.type === 'identity' && parsedMessage.browserFingerprint) {
        this.handleIdentity(ws, parsedMessage, clientId);
        return;
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
          this.userManager.broadcastUserList(this.wss);
          return;
        } catch (error) {
          console.error('Error handling getUsers request:', error);
        }
      }
      
      // Handle name update request
      if (parsedMessage.type === 'updateName' && parsedMessage.userId && parsedMessage.userName) {
        try {
          const success = this.userManager.updateUserName(parsedMessage.userId, parsedMessage.userName);
          if (success) {
            // Broadcast updated user list to all clients
            this.userManager.broadcastUserList(this.wss);
          }
          return;
        } catch (error) {
          console.error('Error handling updateName request:', error);
        }
      }
      
      // Handle user stats request
      if (parsedMessage.type === 'getUserStats' && parsedMessage.userId) {
        try {
          // Send the requested user's stats back to the client
          this.userManager.sendUserStats(ws, parsedMessage.userId);
          return;
        } catch (error) {
          console.error('Error handling getUserStats request:', error);
        }
      }
      
      // Handle record action request (meteor sent or object shot)
      if (parsedMessage.type === 'recordAction' && parsedMessage.action) {
        try {
          // First try to get userId from the message itself
          let userId = parsedMessage.userId;
          
          // If not in message, fall back to client manager
          if (!userId) {
            userId = this.clientManager.getClientUserId(ws);
          }
          
          if (userId) {
            // Update the user's stats
            const updatedStats = this.userManager.updateUserStats(userId, parsedMessage.action);
            
            // Send updated stats back to the client
            ws.send(JSON.stringify({
              type: 'userStats',
              userId: userId,
              stats: updatedStats
            }));
            
            // Since stats have changed, broadcast updated user list
            this.userManager.broadcastUserList(this.wss);
            
            console.log(`Updated stats for ${parsedMessage.action} by user ${userId}`);
          } else {
            console.warn('Could not identify user for recordAction:', parsedMessage);
          }
          return;
        } catch (error) {
          console.error('Error handling recordAction request:', error);
        }
      }
      
      // Handle chat message request
      if (parsedMessage.type === 'chatMessage' && parsedMessage.userId && parsedMessage.text) {
        try {
          // Get user name from the user manager
          const user = this.userManager.getUserById(parsedMessage.userId);
          const userName = user ? user.name : 'Unknown User';
          
          // Add the message to chat manager
          const message = this.chatManager.addMessage(
            parsedMessage.userId,
            userName,
            parsedMessage.text
          );
          
          // Broadcast to all clients
          this.chatManager.broadcastMessage(this.wss, message, ws);

          // Send the message directly to the sender
          // This ensures they still see their own message
          ws.send(JSON.stringify({
            type: 'chatMessage',
            message
          }));
          
          console.log(`Chat message from ${userName} (${parsedMessage.userId}): ${parsedMessage.text.substring(0, 50)}${parsedMessage.text.length > 50 ? '...' : ''}`);
          return;
        } catch (error) {
          console.error('Error handling chat message:', error);
        }
      }
      
      // Handle chat history request
      if (parsedMessage.type === 'getChatHistory') {
        try {
          console.log(`Sending chat history to client ${clientId}`);
          this.chatManager.sendChatHistory(ws);
          return;
        } catch (error) {
          console.error('Error sending chat history:', error);
        }
      }

      // Handle update user location request
      if (parsedMessage.type === 'updateUserLocation' && parsedMessage.userId && parsedMessage.location) {
        try {
          // Look up the user
          const user = this.userManager.getUserById(parsedMessage.userId);
          
          if (user) {
            console.log(`Updating location for user ${parsedMessage.userId} from ${user.location || 'Unknown'} to ${parsedMessage.location}`);
            
            // Update in browser to user mapping
            for (const [fp, userData] of this.userManager.browserToUser.entries()) {
              if (userData.userId === parsedMessage.userId) {
                userData.location = parsedMessage.location;
                break;
              }
            }
            
            // Update in users map
            if (this.userManager.users.has(parsedMessage.userId)) {
              const userData = this.userManager.users.get(parsedMessage.userId);
              userData.location = parsedMessage.location;
            }
            
            // Update in user stats
            const stats = this.userManager.getUserStats(parsedMessage.userId);
            if (stats) {
              stats.location = parsedMessage.location;
            }
            
            // Broadcast updated user list to all clients
            this.userManager.broadcastUserList(this.wss);
          } else {
            console.warn(`Failed to update location: User ${parsedMessage.userId} not found`);
          }
        } catch (error) {
          console.error('Error handling updateUserLocation request:', error);
        }
        return;
      }

      // Handle world position and rotation updates
      if (parsedMessage.type === 'worldUpdate' && parsedMessage.userId && 
        parsedMessage.position && parsedMessage.rotation) {
      try {
        const { userId, position, rotation } = parsedMessage;
        
        // Validate the position and rotation data
        if (typeof position.x !== 'number' || typeof position.y !== 'number' || 
            typeof position.z !== 'number' || typeof rotation.y !== 'number') {
          console.warn('Invalid world update data:', parsedMessage);
          return;
        }
        
        console.log(`World update from user ${userId}: pos(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), rot(${rotation.y.toFixed(2)})`);
        
        // Broadcast the update to all other clients
        this.wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'worldUpdate',
                userId,
                position,
                rotation
              }));
            } catch (error) {
              console.error('Error broadcasting world update:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling world update:', error);
      }
      }

      // Handle projectile messages
      if (parsedMessage.type === 'projectile' && 
        parsedMessage.sourceId && 
        parsedMessage.position && 
        parsedMessage.direction) {
      try {
        const { sourceId, position, direction, damage, speed, comboLevel, id } = parsedMessage;
        
        // Validate the projectile data
        if (typeof position.x !== 'number' || 
            typeof position.y !== 'number' || 
            typeof position.z !== 'number' || 
            typeof direction.x !== 'number' || 
            typeof direction.y !== 'number' || 
            typeof direction.z !== 'number') {
          console.warn('Invalid projectile data:', parsedMessage);
          return;
        }
        
        // Validate damage and speed (optional)
        const validatedDamage = typeof damage === 'number' && damage >= 0 && damage <= 100 
          ? damage 
          : 20; // Default to 20 if invalid
        
        const validatedSpeed = typeof speed === 'number' && speed > 0 && speed <= 2 
          ? speed 
          : 0.5; // Default to 0.5 if invalid
        
        console.log(`Projectile from user ${sourceId}: pos(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), damage: ${validatedDamage}, combo: ${comboLevel || 1}`);
        
        // Broadcast the projectile to all other clients
        this.wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'projectile',
                id: id || `server-${Date.now()}`,
                sourceId,
                position,
                direction,
                damage: validatedDamage,
                speed: validatedSpeed,
                comboLevel: comboLevel || 1
              }));
            } catch (error) {
              console.error('Error broadcasting projectile:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling projectile message:', error);
      }
      }

      // Handle projectile hit messages
      if (parsedMessage.type === 'projectileHit' && 
        parsedMessage.sourceId && 
        parsedMessage.targetId && 
        parsedMessage.projectileId) {
      try {
        const { sourceId, targetId, projectileId, position, damage } = parsedMessage;
        
        console.log(`Projectile hit: ${projectileId} from ${sourceId} hit ${targetId} for ${damage} damage`);
        
        // Broadcast the hit to all clients
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'projectileHit',
                projectileId,
                sourceId,
                targetId,
                position: position || { x: 0, y: 0, z: 0 },
                damage: typeof damage === 'number' ? damage : 20
              }));
            } catch (error) {
              console.error('Error broadcasting projectile hit:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling projectile hit message:', error);
      }
      }

      // Handle damage messages
      if (parsedMessage.type === 'damage' && 
        parsedMessage.sourceId && 
        parsedMessage.targetId && 
        typeof parsedMessage.amount === 'number') {
      try {
        const { sourceId, targetId, amount } = parsedMessage;
        
        // Validate damage amount
        const validatedAmount = amount >= 0 && amount <= 100 ? amount : 20;
        
        console.log(`Damage: ${sourceId} dealt ${validatedAmount} damage to ${targetId}`);
        
        // Look up the target user
        const targetUser = this.userManager.getUserById(targetId);
        
        // Look up the source user
        const sourceUser = this.userManager.getUserById(sourceId);
        
        if (!targetUser) {
          console.warn(`Damage target user ${targetId} not found`);
        }
        
        if (!sourceUser) {
          console.warn(`Damage source user ${sourceId} not found`);
        }
        
        // You could add stats tracking here if desired
        // Example: this.userManager.recordDamageDealt(sourceId, validatedAmount);
        // Example: this.userManager.recordDamageTaken(targetId, validatedAmount);
        
        // Broadcast the damage to all clients except the sender
        this.wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'damage',
                sourceId,
                targetId,
                amount: validatedAmount
              }));
            } catch (error) {
              console.error('Error broadcasting damage:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling damage message:', error);
      }
      }

      // Handle health update messages
      if (parsedMessage.type === 'healthUpdate' && 
        parsedMessage.userId && 
        typeof parsedMessage.health === 'number') {
      try {
        const { userId, health } = parsedMessage;
        
        // Validate health value
        const validatedHealth = health >= 0 && health <= 100 ? health : 100;
        
        console.log(`Health update: ${userId} health now ${validatedHealth}`);
        
        // Broadcast the health update to all other clients
        this.wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'healthUpdate',
                userId,
                health: validatedHealth
              }));
            } catch (error) {
              console.error('Error broadcasting health update:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling health update message:', error);
      }
      }
      
      // Broadcast the message to all connected clients (except sender)
      this.broadcastMessage(ws, msgStr);
    } catch (error) {
      this.serverState.incrementErrors();
      console.error('Error handling message:', error);
    }
  }
  
// This is the updated handleIdentity method for server.js
async handleIdentity(ws, parsedMessage, clientId) {
  try {
    const browserFingerprint = parsedMessage.browserFingerprint;
    const providedUserId = parsedMessage.userId;
    const providedUserName = parsedMessage.userName;
    
    console.log(`Received identity with browser fingerprint: ${browserFingerprint}`);
    
    // Update client with the browser fingerprint
    this.clientManager.updateClientBrowserFingerprint(ws, browserFingerprint);
    
    // Process user identity and send welcome message - now async
    const userData = await this.userManager.processUserIdentity(
      browserFingerprint, 
      providedUserId, 
      providedUserName, 
      this.clientManager.getClientIp(ws),
      this.clientManager.getClientOrigin(ws)
    );
    
    // Update client with user ID
    this.clientManager.updateClientUserId(ws, userData.userId);
    
    // Send welcome message
    try {
      ws.send(JSON.stringify({
        type: 'welcome',
        message: userData.isReturning ? 'Welcome back to Paraverse' : 'Connected to Paraverse WebSocket Server',
        id: clientId,
        userId: userData.userId,
        userName: userData.userName,
        firstJoined: userData.firstJoined,
        location: userData.location,
        status: userData.status || 'online',  // Include status in welcome message
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Error sending welcome message:', error);
    }
    
    // Broadcast updated user list
    this.userManager.broadcastUserList(this.wss);
  } catch (error) {
    console.error('Error handling identity message:', error);
  }
}
  
  handleClose(ws, code, reason, clientId) {
    console.log(`Client ${clientId} disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    
    // Check if we need to broadcast user list after disconnection
    const shouldBroadcast = this.clientManager.removeClient(ws);
    
    if (shouldBroadcast) {
      this.userManager.broadcastUserList(this.wss);
    }
  }
  
  broadcastMessage(excludeWs, message) {
    this.wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting message:', error);
        }
      }
    });
  }
  
  setupIntervals() {
    // Health check interval - logs server status every minute
    setInterval(() => {
      const uptime = Math.floor((Date.now() - this.serverState.getStartTime()) / 1000);
      console.log(
        `[Health] Uptime: ${uptime}s, Clients: ${this.wss.clients.size}, ` +
        `Total connections: ${this.serverState.getConnections()}, ` +
        `Messages: ${this.serverState.getMessages()}, ` +
        `Errors: ${this.serverState.getErrors()}, ` +
        `Unique browsers: ${this.userManager.getBrowserCount()}`
      );
    }, 60000);
    
    // Cleanup interval - periodically check for zombie entries
    setInterval(() => {
      const pruned = this.userManager.pruneInactiveBrowsers(this.clientManager);
      if (pruned > 0) {
        this.userManager.broadcastUserList(this.wss);
      }
    }, 3600000); // Run every hour
  }
  
  start() {
    // Start the server
    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`WebSocket server running on port ${this.port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Environment PORT: ${process.env.PORT || 'not set, using default'}`);
    });
  }
}

// Export the server class
module.exports = WebSocketServer;