const WebSocket = require('ws');
const http = require('http');
const UserManager = require('./managers/UserManager');
const ClientManager = require('./managers/ClientManager');
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
      
      // Broadcast the message to all connected clients (except sender)
      this.broadcastMessage(ws, msgStr);
    } catch (error) {
      this.serverState.incrementErrors();
      console.error('Error handling message:', error);
    }
  }
  
  handleIdentity(ws, parsedMessage, clientId) {
    try {
      const browserFingerprint = parsedMessage.browserFingerprint;
      const providedUserId = parsedMessage.userId;
      const providedUserName = parsedMessage.userName;
      
      console.log(`Received identity with browser fingerprint: ${browserFingerprint}`);
      
      // Update client with the browser fingerprint
      this.clientManager.updateClientBrowserFingerprint(ws, browserFingerprint);
      
      // Process user identity and send welcome message
      const userData = this.userManager.processUserIdentity(
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