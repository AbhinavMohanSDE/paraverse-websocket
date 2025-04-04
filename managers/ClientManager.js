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

  /**
   * New method to track associations between browser fingerprints and user IDs
   * This helps detect and prevent identity confusion issues
   */
  recordUserAssociation(browserFingerprint, userId) {
    // Check if we already have a userAssociations map
    if (!this.userAssociations) {
      this.userAssociations = new Map();
    }
    
    // Record this association
    this.userAssociations.set(browserFingerprint, userId);
    
    // Also maintain the reverse lookup
    if (!this.userToFingerprints) {
      this.userToFingerprints = new Map();
    }
    
    // A user can have multiple fingerprints (multiple devices/browsers)
    if (!this.userToFingerprints.has(userId)) {
      this.userToFingerprints.set(userId, new Set());
    }
    
    this.userToFingerprints.get(userId).add(browserFingerprint);
    
    // Log for debugging
    console.log(`Recorded association: Browser ${browserFingerprint.substring(0, 8)}... -> User ${userId}`);
    
    // Check for potential issues (multiple fingerprints for a single user) 
    // This is normal but log for visibility
    const fingerprints = this.userToFingerprints.get(userId);
    if (fingerprints && fingerprints.size > 1) {
      console.log(`User ${userId} has ${fingerprints.size} associated fingerprints (multiple devices/browsers)`);
    }
  }

  /**
   * Check if a userId is already associated with a different fingerprint
   * This helps prevent identity conflicts
   */
  isUserAssociatedWithDifferentFingerprint(userId, currentFingerprint) {
    if (!this.userToFingerprints || !this.userToFingerprints.has(userId)) {
      return false;
    }
    
    const fingerprints = this.userToFingerprints.get(userId);
    
    // Check if any of the fingerprints associated with this userId are different 
    // from the current one
    for (const fp of fingerprints) {
      if (fp !== currentFingerprint) {
        console.warn(`User ${userId} is already associated with another fingerprint ${fp.substring(0, 8)}...`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Rate limit connections from a single IP
   * Returns true if the connection should be allowed, false if it should be throttled
   */
  shouldAllowConnection(clientIp) {
    // Initialize IP tracking if not exists
    if (!this.ipConnections) {
      this.ipConnections = new Map();
    }
    
    const now = Date.now();
    const ipData = this.ipConnections.get(clientIp) || {
      connectionAttempts: [],
      blockedUntil: 0
    };
    
    // Check if IP is currently blocked
    if (ipData.blockedUntil > now) {
      console.warn(`Connection from ${clientIp} blocked until ${new Date(ipData.blockedUntil).toISOString()}`);
      return false;
    }
    
    // Clean up old connection attempts (older than 60 seconds)
    ipData.connectionAttempts = ipData.connectionAttempts.filter(time => now - time < 60000);
    
    // Add this attempt
    ipData.connectionAttempts.push(now);
    
    // Check if too many connection attempts
    if (ipData.connectionAttempts.length > 20) {
      // More than 20 connections in 60 seconds - block for 2 minutes
      ipData.blockedUntil = now + 120000; // 2 minutes
      console.warn(`Too many connections from ${clientIp}, blocking for 2 minutes`);
      this.ipConnections.set(clientIp, ipData);
      return false;
    }
    
    // Update IP data
    this.ipConnections.set(clientIp, ipData);
    return true;
  }

  /**
   * Find all connections for a given userId
   */
  getConnectionsByUserId(userId) {
    const connections = [];
    
    for (const [ws, clientData] of this.connectedClients.entries()) {
      if (clientData.userId === userId) {
        connections.push(ws);
      }
    }
    
    return connections;
  }

  /**
   * Check if a user has too many concurrent connections
   * Returns true if the connection limit is exceeded
   */
  hasUserExceededConnectionLimit(userId) {
    // Allow at most 5 concurrent connections per user
    const MAX_CONNECTIONS_PER_USER = 5;
    
    const connections = this.getConnectionsByUserId(userId);
    return connections.length > MAX_CONNECTIONS_PER_USER;
  }
}

module.exports = ClientManager;