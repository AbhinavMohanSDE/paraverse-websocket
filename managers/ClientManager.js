class ClientManager {
  constructor(userManager, serverState) {
    // Track connected clients
    this.connectedClients = new Map();
    this.userManager = userManager;
    this.serverState = serverState;
  }
  
  /**
   * Register a new client connection
   */
  registerClient(ws, clientIp, clientOrigin) {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Initialize connection metadata
    this.connectedClients.set(ws, {
      id: clientId,
      userId: null, // Will be set after identity is established
      browserFingerprint: null,
      ip: clientIp,
      origin: clientOrigin,
      connected: Date.now(),
      messages: 0
    });
    
    return clientId;
  }
  
  /**
   * Update client activity
   */
  updateClientActivity(ws) {
    const client = this.connectedClients.get(ws);
    if (client) {
      client.messages++;
      client.lastActivity = Date.now();
      
      // If we have a browser fingerprint, update user activity
      if (client.browserFingerprint) {
        this.userManager.updateUserActivity(client.browserFingerprint);
      }
    }
  }
  
  /**
   * Update client's browser fingerprint
   */
  updateClientBrowserFingerprint(ws, fingerprint) {
    const client = this.connectedClients.get(ws);
    if (client) {
      client.browserFingerprint = fingerprint;
    }
  }
  
  /**
   * Update client's user ID
   */
  updateClientUserId(ws, userId) {
    const client = this.connectedClients.get(ws);
    if (client) {
      client.userId = userId;
    }
  }
  
  /**
   * Get client IP
   */
  getClientIp(ws) {
    const client = this.connectedClients.get(ws);
    return client ? client.ip : null;
  }

  /**
   * Get client's user ID
   */
  getClientUserId(ws) {
    const client = this.connectedClients.get(ws);
    return client ? client.userId : null;
  }
  
  /**
   * Get client origin
   */
  getClientOrigin(ws) {
    const client = this.connectedClients.get(ws);
    return client ? client.origin : null;
  }
  
  /**
   * Remove a client connection and determine if we need to broadcast
   * Returns: boolean indicating if we should broadcast user list update
   */
  removeClient(ws) {
    console.log(`Removing client...`);
    // Get the client data
    const clientData = this.connectedClients.get(ws);
    this.connectedClients.delete(ws);
    
    // Only broadcast if we need to - check if any other connections exist for this browser
    let shouldBroadcast = true;
    
    if (clientData && clientData.browserFingerprint) {
      let browserStillConnected = this.hasBrowserConnections(clientData.browserFingerprint);
      
      // If the browser is no longer connected, set the user to offline
      if (!browserStillConnected) {
        console.log(`Browser ${clientData.browserFingerprint} has no more connections`);
        
        // Set user status to offline if we have a userId
        if (clientData.userId) {
          this.userManager.updateUserStatus(clientData.userId, 'offline');
          console.log(`Set user ${clientData.userId} status to offline`);
        }
      } else {
        // Browser still has other connections, no need to update the user list
        console.log(`Browser ${clientData.browserFingerprint} still has other connections`);
        shouldBroadcast = false;
      }
    }
    
    return shouldBroadcast;
  }
  
  /**
   * Check if a browser has any active connections
   */
  hasBrowserConnections(fingerprint) {
    let hasActiveConnections = false;
    
    // Check if any connections exist for this browser
    this.connectedClients.forEach((client) => {
      if (client.browserFingerprint === fingerprint) {
        hasActiveConnections = true;
      }
    });
    
    return hasActiveConnections;
  }
}

module.exports = ClientManager;