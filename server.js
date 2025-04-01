const WebSocket = require('ws');
const http = require('http');
const UserManager = require('./managers/UserManager');
const ClientManager = require('./managers/ClientManager');
const ChatManager = require('./managers/ChatManager');
const ServerState = require('./utils/ServerState');
const { setupErrorHandlers } = require('./utils/ErrorHandlers');
const VoiceManager = require('./managers/VoiceManager');
const GameChatManager = require('./managers/GameChatManager');

// Create main server class
class WebSocketServer {
  constructor(port = process.env.PORT || 8080) {
    this.port = port;
    
    // Create managers
    this.userManager = new UserManager();
    this.serverState = new ServerState();
    this.clientManager = new ClientManager(this.userManager, this.serverState);
    this.chatManager = new ChatManager();
    this.voiceManager = new VoiceManager();
    this.gameChatManager = new GameChatManager();
    
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
    
    // Implement rate limiting by IP address
    if (!this.clientManager.shouldAllowConnection(clientIp)) {
      console.warn(`Connection from ${clientIp} rate limited, closing.`);
      ws.close(1008, 'Rate limit exceeded');
      return;
    }
    
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

      if (parsedMessage.type === 'updatePlayerStat' && 
          parsedMessage.userId && 
          parsedMessage.stat && 
          parsedMessage.value !== undefined) {
        try {
          const { userId, stat, value } = parsedMessage;
          
          // Validate the stat name and value
          if (!this.validatePlayerStat(stat, value)) {
            console.warn(`Invalid player stat update: ${stat}=${value}`);
            return;
          }
          
          console.log(`Player stat update from ${userId}: ${stat}=${value}`);
          
          // Update the user's stats in the UserManager
          this.userManager.updatePlayerGameStat(userId, stat, value);
          
          // Broadcast the stat update to all clients
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify({
                  type: 'updatePlayerStat',
                  userId,
                  stat,
                  value
                }));
              } catch (error) {
                console.error('Error broadcasting player stat update:', error);
              }
            }
          });
          
          return;
        } catch (error) {
          console.error('Error handling player stat update:', error);
        }
      }

      // Handle game chat message
      if (parsedMessage.type === 'gameChat' && parsedMessage.userId && parsedMessage.text) {
        try {
          // Get user name from the user manager
          const user = this.userManager.getUserById(parsedMessage.userId);
          const userName = user ? user.name : 'Unknown Player';
          
          // Create game chat message object
          const gameChatMessage = {
            userId: parsedMessage.userId,
            userName: userName,
            text: parsedMessage.text
          };
          
          // Broadcast to all clients except sender
          this.gameChatManager.broadcastGameMessage(this.wss, gameChatMessage, ws);

          // Send the message directly to the sender
          // This ensures they still see their own message
          this.gameChatManager.sendDirectGameMessage(ws, gameChatMessage);
          
          console.log(`Game chat message from ${userName} (${parsedMessage.userId}): ${parsedMessage.text.substring(0, 50)}${parsedMessage.text.length > 50 ? '...' : ''}`);
          return;
        } catch (error) {
          console.error('Error handling game chat message:', error);
        }
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

      if (parsedMessage.type === 'meleeAttack' && 
        parsedMessage.sourceId && 
        parsedMessage.position && 
        parsedMessage.direction) {
        try {
          const { sourceId, position, direction, attackType, timestamp } = parsedMessage;
          
          // Validate the melee attack data
          if (typeof position.x !== 'number' || 
              typeof position.y !== 'number' || 
              typeof position.z !== 'number' || 
              typeof direction.x !== 'number' || 
              typeof direction.y !== 'number' || 
              typeof direction.z !== 'number') {
            console.warn('Invalid melee attack data:', parsedMessage);
            return;
          }
          
          console.log(`Melee attack from user ${sourceId}: pos(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
          
          // Broadcast the melee attack to all other clients
          this.wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify({
                  type: 'meleeAttack',
                  sourceId,
                  position,
                  direction,
                  attackType: attackType || 'melee',
                  timestamp: timestamp || Date.now()
                }));
              } catch (error) {
                console.error('Error broadcasting melee attack:', error);
              }
            }
          });
          
          return;
        } catch (error) {
          console.error('Error handling melee attack message:', error);
        }
      }

      // Handle skill used messages
      if (parsedMessage.type === 'skillUsed' && 
        parsedMessage.sourceId && 
        parsedMessage.position && 
        parsedMessage.direction &&
        parsedMessage.skillType) {
      try {
        const { sourceId, position, direction, skillType, timestamp, ...additionalData } = parsedMessage;
        
        // Validate the skill data
        if (typeof position.x !== 'number' || 
            typeof position.y !== 'number' || 
            typeof position.z !== 'number' || 
            typeof direction.x !== 'number' || 
            typeof direction.y !== 'number' || 
            typeof direction.z !== 'number') {
          console.warn('Invalid skill data:', parsedMessage);
          return;
        }
        
        console.log(`Skill used: ${skillType} from user ${sourceId}: pos(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
        
        // Broadcast the skill to ALL clients (including sender for consistency)
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'skillUsed',
                skillType,
                sourceId,
                position,
                direction,
                timestamp: timestamp || Date.now(),
                ...additionalData
              }));
            } catch (error) {
              console.error('Error broadcasting skill used:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling skill used message:', error);
      }
      }

      // Handle skill hit messages
      if (parsedMessage.type === 'skillHit' && 
        parsedMessage.sourceId && 
        parsedMessage.targetId && 
        parsedMessage.skillId) {
      try {
        const { sourceId, targetId, skillId, skillType, position, damage } = parsedMessage;
        
        console.log(`Skill hit: ${skillId} from ${sourceId} hit ${targetId} for ${damage} damage`);
        
        // Broadcast the hit to ALL clients (not just excluding sender)
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'skillHit',
                skillId,
                skillType: skillType || 'skill',
                sourceId,
                targetId,
                position: position || { x: 0, y: 0, z: 0 },
                damage: typeof damage === 'number' ? damage : 20,
                timestamp: Date.now() // Add timestamp to ensure message uniqueness
              }));
            } catch (error) {
              console.error('Error broadcasting skill hit:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling skill hit message:', error);
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

      // Handle player flight state messages
      if (parsedMessage.type === 'playerFlightState' && 
        parsedMessage.userId && 
        typeof parsedMessage.isFlying === 'boolean') {
      try {
        const { userId, isFlying } = parsedMessage;
        
        console.log(`Flight state update from user ${userId}: ${isFlying ? 'flying' : 'not flying'}`);
        
        // Broadcast the flight state to all other clients
        this.wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'playerFlightState',
                userId,
                isFlying
              }));
            } catch (error) {
              console.error('Error broadcasting flight state update:', error);
            }
          }
        });
        
        return;
      } catch (error) {
        console.error('Error handling flight state update:', error);
      }
      }

      if (parsedMessage.type === 'playerAnimation' && 
        parsedMessage.userId && 
        parsedMessage.animationState) {
        try {
          const { userId, animationState, timestamp, startTime } = parsedMessage;
          
          console.log(`Animation update from user ${userId}: ${animationState}${startTime !== undefined ? ` with startTime: ${startTime}` : ''}`);
          
          // Broadcast the animation state to all other clients
          this.wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify({
                  type: 'playerAnimation',
                  userId,
                  animationState,
                  timestamp: timestamp || Date.now(),
                  startTime // Include the startTime parameter in the broadcast
                }));
              } catch (error) {
                console.error('Error broadcasting animation state:', error);
              }
            }
          });
          
          return;
        } catch (error) {
          console.error('Error handling animation update:', error);
        }
      }
      
      // Handle voice join requests
      if (parsedMessage.type === 'voiceJoin' && parsedMessage.userId) {
        try {
          const userId = parsedMessage.userId;
          
          // Check if user exists
          const user = this.userManager.getUserById(userId);
          if (!user) {
            console.warn(`Voice join request from unknown user: ${userId}`);
            return;
          }
          
          // Add user to voice participants
          const added = this.voiceManager.addParticipant(userId);
          
          if (added) {
            // Broadcast join message to all clients
            this.wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify({
                    type: 'voiceJoin',
                    userId
                  }));
                } catch (error) {
                  console.error('Error broadcasting voice join:', error);
                }
              }
            });
            
            // Also send the current participants list
            this.voiceManager.broadcastParticipantsList(this.wss);
          }
          
          console.log(`Processed voice join for user ${userId}`);
          return;
        } catch (error) {
          console.error('Error handling voice join request:', error);
        }
      }

      // Handle voice leave requests
      if (parsedMessage.type === 'voiceLeave' && parsedMessage.userId) {
        try {
          const userId = parsedMessage.userId;
          
          // Remove user from voice participants
          const removed = this.voiceManager.removeParticipant(userId);
          
          if (removed) {
            // Broadcast leave message to all clients
            this.wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify({
                    type: 'voiceLeave',
                    userId
                  }));
                } catch (error) {
                  console.error('Error broadcasting voice leave:', error);
                }
              }
            });
            
            // Also send the updated participants list
            this.voiceManager.broadcastParticipantsList(this.wss);
          }
          
          console.log(`Processed voice leave for user ${userId}`);
          return;
        } catch (error) {
          console.error('Error handling voice leave request:', error);
        }
      }

      // Handle voice activity (talking) updates
      if (parsedMessage.type === 'voiceActivity' && 
          parsedMessage.userId && 
          typeof parsedMessage.isTalking === 'boolean') {
        try {
          const { userId, isTalking } = parsedMessage;
          
          // Only process if user is a voice participant
          if (this.voiceManager.isParticipant(userId)) {
            // Update talking state
            this.voiceManager.updateTalkingState(userId, isTalking);
            
            // Broadcast activity message to all other clients
            this.wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify({
                    type: 'voiceActivity',
                    userId,
                    isTalking
                  }));
                } catch (error) {
                  console.error('Error broadcasting voice activity:', error);
                }
              }
            });
          }
          
          // Don't log every activity message to avoid console spam
          if (isTalking) {
            console.log(`User ${userId} is talking`);
          }
          return;
        } catch (error) {
          console.error('Error handling voice activity update:', error);
        }
      }

      // Handle voice mute updates
      if (parsedMessage.type === 'voiceMute' && 
          parsedMessage.userId && 
          typeof parsedMessage.muted === 'boolean') {
        try {
          const { userId, muted } = parsedMessage;
          
          // Only process if user is a voice participant
          if (this.voiceManager.isParticipant(userId)) {
            // Update muted state
            this.voiceManager.updateMutedState(userId, muted);
            
            // Broadcast mute message to all clients
            this.wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify({
                    type: 'voiceMute',
                    userId,
                    muted
                  }));
                } catch (error) {
                  console.error('Error broadcasting voice mute update:', error);
                }
              }
            });
            
            console.log(`User ${userId} ${muted ? 'muted' : 'unmuted'} their microphone`);
          }
          return;
        } catch (error) {
          console.error('Error handling voice mute update:', error);
        }
      }

      // Handle get voice participants request
      if (parsedMessage.type === 'getVoiceParticipants') {
        try {
          console.log('Received request for voice participants list');
          this.voiceManager.broadcastParticipantsList(this.wss);
          return;
        } catch (error) {
          console.error('Error handling get voice participants request:', error);
        }
      }

      // Broadcast the message to all connected clients (except sender)
      this.broadcastMessage(ws, msgStr);
    } catch (error) {
      this.serverState.incrementErrors();
      console.error('Error handling message:', error);
    }
  }
  
  // This is the enhanced handleIdentity method for server.js
  async handleIdentity(ws, parsedMessage, clientId) {
    try {
      const browserFingerprint = parsedMessage.browserFingerprint;
      const providedUserId = parsedMessage.userId;
      const providedUserName = parsedMessage.userName;
      const clientIp = this.clientManager.getClientIp(ws);
      
      if (!browserFingerprint) {
        console.error('Missing browser fingerprint in identity message');
        this.sendErrorMessage(ws, 'Missing browser fingerprint');
        return;
      }
      
      console.log(`Received identity with browser fingerprint: ${browserFingerprint}`);
      
      // Update client with the browser fingerprint
      this.clientManager.updateClientBrowserFingerprint(ws, browserFingerprint);
      
      // Check for IP address information to enhance fingerprinting
      const ipSuffix = clientIp ? clientIp.split('.').slice(-1).join('.') : '';
      
      // Send IP suffix back to client for enhanced fingerprinting
      if (ipSuffix) {
        try {
          ws.send(JSON.stringify({
            type: 'fingerprintEnhancement',
            ipSuffix: ipSuffix
          }));
        } catch (error) {
          console.error('Error sending fingerprint enhancement:', error);
        }
      }
      
      // Process user identity and send welcome message - now async
      const userData = await this.userManager.processUserIdentity(
        browserFingerprint, 
        providedUserId, 
        providedUserName, 
        clientIp,
        this.clientManager.getClientOrigin(ws)
      );
      
      // Check if this user has too many connections already
      if (this.clientManager.hasUserExceededConnectionLimit(userData.userId)) {
        console.warn(`User ${userData.userId} has exceeded connection limit, closing this connection`);
        ws.close(1013, 'Too many connections for this user');
        return;
      }
      
      // Update client with user ID
      this.clientManager.updateClientUserId(ws, userData.userId);
      
      // Record this association in memory
      this.clientManager.recordUserAssociation(browserFingerprint, userData.userId);
      
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
          status: userData.status || 'online',
          timestamp: Date.now(),
          // Include if there was a conflict that was resolved
          identityConflictResolved: userData.conflictDetected || false
        }));
        
        // Also log this connection for debugging purposes
        console.log(`User authenticated: ${userData.userId} (${userData.userName}) from fingerprint ${browserFingerprint.substring(0, 8)}...`);
      } catch (error) {
        console.error('Error sending welcome message:', error);
      }
      
      // Broadcast updated user list
      this.userManager.broadcastUserList(this.wss);
    } catch (error) {
      console.error('Error handling identity message:', error);
      this.sendErrorMessage(ws, 'Error processing identity');
    }
  }

  // Helper method to send error messages
  sendErrorMessage(ws, message) {
    try {
      ws.send(JSON.stringify({
        type: 'error',
        message: message,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Error sending error message:', error);
    }
  }
  
  handleClose(ws, code, reason, clientId) {
    console.log(`Client ${clientId} disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    
    // Check if we need to broadcast user list after disconnection
    const shouldBroadcast = this.clientManager.removeClient(ws);
    
    // Get the userId for the disconnected client
    const userId = this.clientManager.getClientUserId(ws);
    if (userId) {
      // Check if the user was in a voice chat
      const wasInVoice = this.voiceManager.handleUserDisconnect(userId);
      
      if (wasInVoice) {
        // Broadcast voice leave message to all remaining clients
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({
                type: 'voiceLeave',
                userId
              }));
            } catch (error) {
              console.error('Error broadcasting voice leave for disconnected user:', error);
            }
          }
        });
        
        // Also broadcast updated voice participants list
        this.voiceManager.broadcastParticipantsList(this.wss);
        console.log(`User ${userId} was removed from voice chat due to disconnection`);
      }
    }

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

  /**
   * Validate player stat name and value
   * @param {string} stat - The stat name
   * @param {any} value - The value to validate
   * @returns {boolean} - Whether the stat/value pair is valid
   */
  validatePlayerStat(stat, value) {
    // Define allowed stats and their validation rules
    const validationRules = {
      // Level should be a number between 1 and 100
      'level': (val) => typeof val === 'number',
      
      // Health should be a number between 0 and 100
      'health': (val) => typeof val === 'number',
      
      // Attack and ability should be numbers between 1 and 100
      'attack': (val) => typeof val === 'number',
      'ability': (val) => typeof val === 'number',
      
      // Weapon, emblem should be strings 
      'weapon': (val) => typeof val === 'string',
      'emblem': (val) => typeof val === 'string',
      
      // Time played should be a string in the format "0d 0h"
      'timePlayed': (val) => typeof val === 'string' && /^\d+d \d+h$/.test(val),
      
      // Animation state can be any string but with reasonable length
      'animationState': (val) => typeof val === 'string'
    };
    
    // Check if the stat is allowed
    if (!validationRules.hasOwnProperty(stat)) {
      console.warn(`Invalid stat name: ${stat}`);
      return false;
    }
    
    // Check if the value passes validation
    const isValid = validationRules[stat](value);
    if (!isValid) {
      console.warn(`Invalid value for stat ${stat}: ${value}`);
      return false;
    }
    
    return true;
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