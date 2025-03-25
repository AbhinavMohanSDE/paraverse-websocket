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
        location: location || 'Unknown',
        status: 'online' // Initialize with online status
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
    } else if (action === 'objectShot') {
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
   * Improved to handle fingerprint variations and prevent identity conflicts
   */
  async processUserIdentity(browserFingerprint, providedUserId, providedUserName, clientIp, clientOrigin) {
    // Get approximate location from IP
    const location = await this.getLocationFromIp(clientIp);
    
    // Clean up the fingerprint to be more stable (remove timestamp if present)
    const stableFingerprint = this.getStableFingerprint(browserFingerprint);
    
    // 1. First check: Do we know this exact browser fingerprint?
    let existingUserData = this.browserToUser.get(stableFingerprint);
    
    // 2. If not exact match, check for similar fingerprints
    if (!existingUserData && providedUserId) {
      // Look for any fingerprint associated with this userId
      for (const [fp, userData] of this.browserToUser.entries()) {
        if (userData.userId === providedUserId) {
          console.log(`Found similar fingerprint for userId ${providedUserId}: ${fp} (vs ${stableFingerprint})`);
          existingUserData = userData;
          
          // Associate this fingerprint with the existing user
          // This way we "learn" the new fingerprint variation
          this.browserToUser.set(stableFingerprint, existingUserData);
          break;
        }
      }
    }
    
    // If this browser fingerprint is known and has a user ID
    if (existingUserData) {
      console.log(`Recognized returning browser: ${stableFingerprint} as user: ${existingUserData.userId}, ${existingUserData.userName}`);
      
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
      
      // Update location if needed
      if (location && (!existingUserData.location || 
          existingUserData.location === 'Unknown' || 
          existingUserData.location === 'Earth')) {
        existingUserData.location = location;
        
        // Also update in users map
        const userData = this.users.get(existingUserData.userId);
        if (userData) {
          userData.location = location;
        }
        
        console.log(`Updated location for ${existingUserData.userId} to ${location}`);
      }
      
      // Set status to online when user reconnects
      existingUserData.status = 'online';
      existingUserData.lastStatusChange = Date.now();
      
      // Also update in users map
      const userData = this.users.get(existingUserData.userId);
      if (userData) {
        userData.status = 'online';
        userData.lastStatusChange = Date.now();
      }
      
      // Ensure we have stats for this user
      const stats = this.initUserStats(existingUserData.userId, existingUserData.firstJoined, existingUserData.location);
      
      // Update the stats status to online
      if (stats) {
        stats.status = 'online';
      }
      
      return {
        userId: existingUserData.userId,
        userName: existingUserData.userName,
        isReturning: true,
        firstJoined: existingUserData.firstJoined,
        location: existingUserData.location || location,
        status: 'online'
      };
    } 
    // If this is a new browser
    else {
      // Handle provided userId validation with improved logic
      let isProvidedUserIdValid = false;
      let conflictDetected = false;
      
      if (providedUserId) {
        isProvidedUserIdValid = true;
        
        // Track if we found any conflicts
        let conflictingFingerprints = [];
        
        // Check for any userId conflicts
        for (const [fp, userData] of this.browserToUser.entries()) {
          if (userData.userId === providedUserId) {
            conflictingFingerprints.push(fp);
            // We found a conflict but we won't immediately invalidate
          }
        }
        
        // If conflicts exist, check if they're recent users
        if (conflictingFingerprints.length > 0) {
          conflictDetected = true;
          console.warn(`Provided userId ${providedUserId} has ${conflictingFingerprints.length} conflicting fingerprints`);
          
          // Check if any of the conflicting fingerprints have recent activity
          const now = Date.now();
          const MAX_INACTIVE_TIME = 7 * 24 * 60 * 60 * 1000; // 7 days
          
          let allInactive = true;
          
          for (const fp of conflictingFingerprints) {
            const userData = this.browserToUser.get(fp);
            const lastActivity = userData.lastActivity || userData.firstSeen || 0;
            
            if (now - lastActivity < MAX_INACTIVE_TIME) {
              allInactive = false;
              break;
            }
          }
          
          // If all conflicting fingerprints are inactive (old), we can reuse the userId
          if (allInactive) {
            console.log(`All conflicting fingerprints for ${providedUserId} are inactive, allowing reuse`);
            conflictDetected = false;
          } else {
            // Active conflict - invalidate provided userId
            isProvidedUserIdValid = false;
          }
        }
      }
      
      // Generate a new userId if provided one is invalid or not provided
      const userId = (isProvidedUserIdValid && providedUserId) || 
                    `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      // For name, use provided name or generate a guest name
      const userName = providedUserName || this.generateGuestName();
      
      // Current timestamp for first joined
      const firstJoined = new Date().toISOString();
      
      // Store this data for the browser fingerprint
      this.browserToUser.set(stableFingerprint, {
        userId: userId,
        userName: userName,
        firstSeen: Date.now(),
        lastActivity: Date.now(),
        firstJoined: firstJoined,
        location: location,
        status: 'online',
        lastStatusChange: Date.now()
      });
      
      // Store user data
      this.users.set(userId, {
        id: userId,
        name: userName,
        ip: clientIp,
        origin: clientOrigin,
        connected: Date.now(),
        firstJoined: firstJoined,
        location: location,
        status: 'online',
        lastStatusChange: Date.now()
      });
      
      // Initialize stats for this user with status
      const stats = this.initUserStats(userId, firstJoined, location);
      if (stats) {
        stats.status = 'online';
      }
      
      console.log(`Registered new browser: ${stableFingerprint} as user: ${userId}, ${userName}, location: ${location}, status: online`);
      
      return {
        userId,
        userName,
        isReturning: false,
        firstJoined,
        location,
        status: 'online',
        conflictDetected: conflictDetected // Send this back to client
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
   * Update user status
   */
  updateUserStatus(userId, status) {
    // Find the browser fingerprint for this user
    let fingerprint = null;
    
    for (const [fp, userData] of this.browserToUser.entries()) {
      if (userData.userId === userId) {
        fingerprint = fp;
        userData.status = status;
        userData.lastStatusChange = Date.now();
        break;
      }
    }
    
    if (fingerprint) {
      // Also update in users map
      const userData = this.users.get(userId);
      if (userData) {
        userData.status = status;
        userData.lastStatusChange = Date.now();
      }
      
      // Update in user stats
      const stats = this.getUserStats(userId);
      if (stats) {
        stats.status = status;
      }
      
      console.log(`Updated user status for ${userId} to ${status}`);
      return true;
    }
    
    console.warn(`Failed to update status: User ${userId} not found`);
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
            location: userData.location,
            status: userData.status || 'offline' // Include status with default
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
      
      // Also ensure status is set to online when activity is detected
      userData.status = 'online';
      
      // Update status in userStats too
      if (userData.userId) {
        const stats = this.getUserStats(userData.userId);
        if (stats) {
          stats.status = 'online';
        }
      }
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
      
      // If no active connections, set status to offline
      if (!hasActiveConnections) {
        userData.status = 'offline';
        userData.lastStatusChange = Date.now();
        
        // Update in userStats too
        if (userData.userId) {
          const stats = this.getUserStats(userData.userId);
          if (stats) {
            stats.status = 'offline';
          }
          
          // Update the user object too
          const user = this.users.get(userData.userId);
          if (user) {
            user.status = 'offline';
            user.lastStatusChange = Date.now();
          }
        }
        
        // If data is old, mark for pruning
        if (userData.lastActivity && (now - userData.lastActivity > INACTIVE_THRESHOLD)) {
          browsersToPrune.push(fingerprint);
        }
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
          location: userData.location,
          status: userData.status || 'offline' // Include status with default
        };
      }
    }
    
    return null;
  }

  /**
   * Record damage dealt by a user
   */
  recordDamageDealt(userId, amount) {
    const stats = this.getUserStats(userId);
    
    if (!stats.damageDealt) {
      stats.damageDealt = 0;
    }
    
    stats.damageDealt += amount;
    console.log(`User ${userId} has dealt a total of ${stats.damageDealt} damage`);
    return stats;
  }

  /**
   * Record damage taken by a user
   */
  recordDamageTaken(userId, amount) {
    const stats = this.getUserStats(userId);
    
    if (!stats.damageTaken) {
      stats.damageTaken = 0;
    }
    
    stats.damageTaken += amount;
    console.log(`User ${userId} has taken a total of ${stats.damageTaken} damage`);
    return stats;
  }

  /**
   * Record a player kill
   */
  recordPlayerKill(killerUserId, victimUserId) {
    const killerStats = this.getUserStats(killerUserId);
    const victimStats = this.getUserStats(victimUserId);
    
    // Track kills for killer
    if (!killerStats.kills) {
      killerStats.kills = 0;
    }
    killerStats.kills += 1;
    
    // Track deaths for victim
    if (!victimStats.deaths) {
      victimStats.deaths = 0;
    }
    victimStats.deaths += 1;
    
    console.log(`User ${killerUserId} killed user ${victimUserId}`);
    return killerStats;
  }

  /**
   * Initialize stats for a user - updated with combat stats
   */
  initUserStats(userId, firstJoined, location) {
    if (!this.userStats.has(userId)) {
      this.userStats.set(userId, {
        meteorsSent: 0,
        objectsShot: 0,
        firstJoined: firstJoined || new Date().toISOString(),
        location: location || 'Unknown',
        status: 'online',
        // Combat statistics
        health: 100,
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
        deaths: 0,
        projectilesFired: 0,
        projectileHits: 0
      });
    }
    return this.userStats.get(userId);
  }

  /**
   * Update user stats - enhanced with projectile tracking
   */
  updateUserStats(userId, action, amount = 1) {
    const stats = this.getUserStats(userId);
    
    if (action === 'meteorSent') {
      stats.meteorsSent += 1;
    } else if (action === 'objectShot') {
      stats.objectsShot += 1;
    } else if (action === 'projectileFired') {
      if (!stats.projectilesFired) stats.projectilesFired = 0;
      stats.projectilesFired += amount;
    } else if (action === 'projectileHit') {
      if (!stats.projectileHits) stats.projectileHits = 0;
      stats.projectileHits += amount;
    }
    
    console.log(`Updated stats for user ${userId}: ${JSON.stringify(stats)}`);
    return stats;
  }

  /**
   * Get stable fingerprint by removing timestamps or random elements
   */
  getStableFingerprint(fingerprint) {
    if (!fingerprint) return fingerprint;
    
    // If the fingerprint contains a timestamp (often added by clients), remove it
    // Example: "browser-abc123-1615484848"
    const timestampPattern = /-\d{9,}$/;
    if (timestampPattern.test(fingerprint)) {
      return fingerprint.replace(timestampPattern, '');
    }
    
    return fingerprint;
  }
  
}

module.exports = UserManager;