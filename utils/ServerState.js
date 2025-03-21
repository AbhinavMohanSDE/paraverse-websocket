/**
 * Class to track server state
 */
class ServerState {
  constructor() {
    this.state = {
      connections: 0,
      messages: 0,
      errors: 0,
      startTime: Date.now(),
      uniqueBrowsers: 0
    };
  }
  
  /**
   * Increment connection count
   */
  incrementConnections() {
    this.state.connections++;
  }
  
  /**
   * Increment message count
   */
  incrementMessages() {
    this.state.messages++;
  }
  
  /**
   * Increment error count
   */
  incrementErrors() {
    this.state.errors++;
  }
  
  /**
   * Get connection count
   */
  getConnections() {
    return this.state.connections;
  }
  
  /**
   * Get message count
   */
  getMessages() {
    return this.state.messages;
  }
  
  /**
   * Get error count
   */
  getErrors() {
    return this.state.errors;
  }
  
  /**
   * Get server start time
   */
  getStartTime() {
    return this.state.startTime;
  }
  
  /**
   * Set unique browser count
   */
  setUniqueBrowsers(count) {
    this.state.uniqueBrowsers = count;
  }
  
  /**
   * Get unique browser count
   */
  getUniqueBrowsers() {
    return this.state.uniqueBrowsers;
  }
}

module.exports = ServerState;