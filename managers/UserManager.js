const WebSocket = require('ws');
const fetch = require('node-fetch'); // Make sure to install this: npm install node-fetch

class UserManager {
  constructor() {
    // Store user data with unique identifiers and names
    this.users = new Map();
    
    // Track browser fingerprints to their user IDs
    this.browserToUser = new Map();
    
    // Track current guest number counter
    this.guestCounter = 1;
    
    // Track user stats for the current session
    this.userStats = new Map();
    
    // Cache for IP-to-location mappings to avoid repeated API calls
    this.locationCache = new Map();
    
    // Cache expiration time (24 hours in milliseconds)
    this.CACHE_EXPIRATION = 24 * 60 * 60 * 1000;
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
   * Initialize stats for a user
   */
  initUserStats(userId, firstJoined, location) {
    if (!this.userStats.has(userId)) {
      this.userStats.set(userId, {
        meteorsSent: 0,
        objectsShot: 0,
        firstJoined: firstJoined || new Date().toISOString(),
        location: location || 'Unknown'
      });
    }
    return this.userStats.get(userId);
  }
  
  /**
   * Get stats for a user
   */
  getUserStats(userId) {
    return this.userStats.get(userId) || this.initUserStats(userId);
  }
  
  /**
   * Update user stats
   */
  updateUserStats(userId, action) {
    const stats = this.getUserStats(userId);
    
    if (action === 'meteorSent') {
      stats.meteorsSent += 1;
    } else if (action === 'objectSShot') {
      stats.objectsShot += 1;
    }
    
    console.log(`Updated stats for user ${userId}: ${JSON.stringify(stats)}`);
    return stats;
  }
  
  /**
   * Send user stats to a client
   */
  sendUserStats(ws, userId) {
    const stats = this.getUserStats(userId);
    
    try {
      ws.send(JSON.stringify({
        type: 'userStats',
        userId,
        stats
      }));
    } catch (error) {
      console.error('Error sending user stats:', error);
    }
  }
  
  /**
   * Format location for display
   */
  formatLocation(city, country) {
    if (city && country) {
      return `${city}, ${country}`;
    } else if (city) {
      return city;
    } else if (country) {
      return country;
    }
    return 'Unknown';
  }
  
  /**
     * Get approximate location from IP address
     * This is now much simpler since we'll rely on client-side location detection
     */
  getLocationFromIp(clientIp) {
    // We're now using the client to determine location, so this just returns a default
    // Remove IPv6 prefix if present
    let ip = clientIp;
    if (ip.indexOf('::ffff:') === 0) {
      ip = ip.substring(7);
    }
    
    // Check for local IPs
    if (ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('192.168.') || 
        ip.startsWith('10.') || ip.startsWith('172.16.')) {
      return 'Earth';
    }
    
    // For all other IPs, return "Earth" as the location will be updated by the client
    return 'Earth';
  }
  
  /**
   * Process user identity and determine if they're new or returning
   */
  async processUserIdentity(browserFingerprint, providedUserId, providedUserName, clientIp, clientOrigin) {
    // Get approximate location from IP
    const location = await this.getLocationFromIp(clientIp);
    
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
      
      // Update the location if it's changed or not set yet
      if (location && (!existingUserData.location || existingUserData.location === 'Unknown' || 
          existingUserData.location === 'Earth' || existingUserData.location === 'Local Network')) {
        existingUserData.location = location;
        
        // Also update in users map
        const userData = this.users.get(existingUserData.userId);
        if (userData) {
          userData.location = location;
        }
        
        console.log(`Updated location for ${existingUserData.userId} to ${location}`);
      }
      
      // Ensure we have stats for this user
      const stats = this.initUserStats(existingUserData.userId, existingUserData.firstJoined, existingUserData.location);
      
      return {
        userId: existingUserData.userId,
        userName: existingUserData.userName,
        isReturning: true,
        firstJoined: existingUserData.firstJoined,
        location: existingUserData.location || location
      };
    } 
    // If this is a new browser or has a provided userId that needs to be stored
    else {
      // Generate or use the provided user data
      const userId = providedUserId || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      // For new users, always use Guest + number naming unless they provided a custom name
      const userName = providedUserName || this.generateGuestName();
      
      // Current timestamp for first joined
      const firstJoined = new Date().toISOString();
      
      // Store this data for the browser fingerprint
      this.browserToUser.set(browserFingerprint, {
        userId: userId,
        userName: userName,
        firstSeen: Date.now(),
        lastActivity: Date.now(),
        firstJoined: firstJoined,
        location: location
      });
      
      // Store user data
      this.users.set(userId, {
        id: userId,
        name: userName,
        ip: clientIp,
        origin: clientOrigin,
        connected: Date.now(),
        firstJoined: firstJoined,
        location: location
      });
      
      // Initialize stats for this user
      this.initUserStats(userId, firstJoined, location);
      
      console.log(`Registered new browser: ${browserFingerprint} as user: ${userId}, ${userName}, location: ${location}`);
      
      return {
        userId,
        userName,
        isReturning: false,
        firstJoined,
        location
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
   * Broadcast the current user list to all clients with stats
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
          
          // Get user stats
          const stats = this.getUserStats(userData.userId);
          
          activeUsers.push({
            id: userData.userId,
            name: userData.userName,
            stats, // Include stats in user data
            firstJoined: userData.firstJoined,
            location: userData.location
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
      
      // Also remove stats for this user
      this.userStats.delete(userData.userId);
      
      this.browserToUser.delete(fingerprint);
    });
    
    if (browsersToPrune.length > 0) {
      console.log(`Pruned ${browsersToPrune.length} inactive browser entries`);
    }
    
    return browsersToPrune.length;
  }

  /**
   * Get user by ID
   */
  getUserById(userId) {
    // First check the users map
    if (this.users.has(userId)) {
      return this.users.get(userId);
    }
    
    // If not found in users map, try to look up in browserToUser
    for (const [fp, userData] of this.browserToUser.entries()) {
      if (userData.userId === userId) {
        // Construct a user object from browser data
        return {
          id: userData.userId,
          name: userData.userName,
          connected: userData.lastActivity || Date.now(),
          firstJoined: userData.firstJoined,
          location: userData.location
        };
      }
    }
    
    return null;
  }
}

module.exports = UserManager;