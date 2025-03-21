const WebSocket = require('ws');

class UserManager {
  constructor() {
    // Store user data with unique identifiers and names
    this.users = new Map();
    
    // Track browser fingerprints to their user IDs
    this.browserToUser = new Map();
    
    // Track current guest number counter
    this.guestCounter = 1;
  }
  
  /**
   * Get count of unique browsers
   */
  getBrowserCount() {
    return this.browserToUser.size;
  }
  
  /**
   * Generate next guest name
   */
  generateGuestName() {
    const guestName = `Guest${this.guestCounter}`;
    this.guestCounter++;
    return guestName;
  }
  
  /**
   * Process user identity and determine if they're new or returning
   */
  processUserIdentity(browserFingerprint, providedUserId, providedUserName, clientIp, clientOrigin) {
    // Check if this browser fingerprint already has a user
    const existingUserData = this.browserToUser.get(browserFingerprint);
    
    // If this browser fingerprint is known and has a user ID
    if (existingUserData) {
      console.log(`Recognized returning browser: ${browserFingerprint} as user: ${existingUserData.userId}, ${existingUserData.userName}`);
      
      // If user provided a new name, update it
      if (providedUserName && providedUserName !== existingUserData.userName) {
        existingUserData.userName = providedUserName;
        
        // Also update in the users map
        const userData = this.users.get(existingUserData.userId);
        if (userData) {
          userData.name = providedUserName;
        }
        
        console.log(`Updated user name for ${existingUserData.userId} to ${providedUserName}`);
      }
      
      return {
        userId: existingUserData.userId,
        userName: existingUserData.userName,
        isReturning: true
      };
    } 
    // If this is a new browser or has a provided userId that needs to be stored
    else {
      // Generate or use the provided user data
      const userId = providedUserId || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      // For new users, always use Guest + number naming unless they provided a custom name
      const userName = providedUserName || this.generateGuestName();
      
      // Store this data for the browser fingerprint
      this.browserToUser.set(browserFingerprint, {
        userId: userId,
        userName: userName,
        firstSeen: Date.now(),
        lastActivity: Date.now()
      });
      
      // Store user data
      this.users.set(userId, {
        id: userId,
        name: userName,
        ip: clientIp,
        origin: clientOrigin,
        connected: Date.now()
      });
      
      console.log(`Registered new browser: ${browserFingerprint} as user: ${userId}, ${userName}`);
      
      return {
        userId,
        userName,
        isReturning: false
      };
    }
  }
  
  /**
   * Update a user's name
   */
  updateUserName(userId, newName) {
    // Find the browser fingerprint for this user
    let fingerprint = null;
    
    for (const [fp, userData] of this.browserToUser.entries()) {
      if (userData.userId === userId) {
        fingerprint = fp;
        userData.userName = newName;
        userData.lastActivity = Date.now();
        break;
      }
    }
    
    if (fingerprint) {
      // Also update in users map
      const userData = this.users.get(userId);
      if (userData) {
        userData.name = newName;
      }
      
      console.log(`Updated user name for ${userId} to ${newName}`);
      return true;
    }
    
    console.warn(`Failed to update name: User ${userId} not found`);
    return false;
  }
  
  /**
   * Broadcast the current user list to all clients
   */
  broadcastUserList(wss) {
    try {
      // Only use browser fingerprints to determine unique users
      const activeUsers = [];
      const seenUserIds = new Set();
      
      // Collect unique users by browser fingerprint
      this.browserToUser.forEach((userData, fingerprint) => {
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
  
  /**
   * Update user activity
   */
  updateUserActivity(browserFingerprint) {
    const userData = this.browserToUser.get(browserFingerprint);
    if (userData) {
      userData.lastActivity = Date.now();
    }
  }
  
  /**
   * Prune inactive browsers
   */
  pruneInactiveBrowsers(clientManager) {
    const now = Date.now();
    const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    
    // Check for browsers with no connections for more than threshold
    let browsersToPrune = [];
    
    this.browserToUser.forEach((userData, fingerprint) => {
      let hasActiveConnections = clientManager.hasBrowserConnections(fingerprint);
      
      // If no active connections and data is old, mark for pruning
      if (!hasActiveConnections && userData.lastActivity && (now - userData.lastActivity > INACTIVE_THRESHOLD)) {
        browsersToPrune.push(fingerprint);
      }
    });
    
    // Prune inactive browser entries
    browsersToPrune.forEach(fingerprint => {
      const userData = this.browserToUser.get(fingerprint);
      console.log(`Pruning inactive browser: ${fingerprint}, User: ${userData.userName}`);
      this.browserToUser.delete(fingerprint);
    });
    
    if (browsersToPrune.length > 0) {
      console.log(`Pruned ${browsersToPrune.length} inactive browser entries`);
    }
    
    return browsersToPrune.length;
  }
}

module.exports = UserManager;