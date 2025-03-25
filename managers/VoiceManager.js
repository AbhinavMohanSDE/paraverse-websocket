class VoiceManager {
  constructor() {
    // Track users currently in voice chat
    this.voiceParticipants = new Set();
    
    // Track talking state of users
    this.talkingUsers = new Set();
    
    // Track muted state of users
    this.mutedUsers = new Set();
    
    // Track users without microphone
    this.noMicUsers = new Set();
  }
  
  /**
   * Add a user to voice chat
   */
  addParticipant(userId, options = {}) {
    if (!this.voiceParticipants.has(userId)) {
      this.voiceParticipants.add(userId);
      
      // Handle no microphone status if provided
      if (options.noMic) {
        this.noMicUsers.add(userId);
      }
      
      console.log(`User ${userId} joined voice chat, total participants: ${this.voiceParticipants.size}`);
      return true;
    }
    return false;
  }
  
  /**
   * Remove a user from voice chat
   */
  removeParticipant(userId) {
    if (this.voiceParticipants.has(userId)) {
      this.voiceParticipants.delete(userId);
      
      // Clean up all states
      this.talkingUsers.delete(userId);
      this.mutedUsers.delete(userId);
      this.noMicUsers.delete(userId);
      
      console.log(`User ${userId} left voice chat, total participants: ${this.voiceParticipants.size}`);
      return true;
    }
    return false;
  }
  
  /**
   * Check if a user is in voice chat
   */
  isParticipant(userId) {
    return this.voiceParticipants.has(userId);
  }
  
  /**
   * Get list of all voice participants
   */
  getParticipants() {
    return Array.from(this.voiceParticipants);
  }
  
  /**
   * Update user's talking state
   */
  updateTalkingState(userId, isTalking) {
    // Don't update talking state for users with no mic
    if (this.noMicUsers.has(userId)) {
      return;
    }
    
    if (isTalking) {
      this.talkingUsers.add(userId);
    } else {
      this.talkingUsers.delete(userId);
    }
  }
  
  /**
   * Update user's muted state
   */
  updateMutedState(userId, isMuted) {
    if (isMuted) {
      this.mutedUsers.add(userId);
    } else {
      this.mutedUsers.delete(userId);
    }
  }
  
  /**
   * Update user's microphone status
   */
  updateMicrophoneStatus(userId, hasNoMic) {
    if (hasNoMic) {
      this.noMicUsers.add(userId);
      // Users with no mic can't be talking
      this.talkingUsers.delete(userId);
    } else {
      this.noMicUsers.delete(userId);
    }
  }
  
  /**
   * Check if a user is currently talking
   */
  isTalking(userId) {
    return this.talkingUsers.has(userId);
  }
  
  /**
   * Check if a user is currently muted
   */
  isMuted(userId) {
    return this.mutedUsers.has(userId);
  }
  
  /**
   * Check if a user has no microphone
   */
  hasNoMic(userId) {
    return this.noMicUsers.has(userId);
  }
  
  /**
   * Process a user disconnection
   */
  handleUserDisconnect(userId) {
    return this.removeParticipant(userId);
  }
  
  /**
   * Get detailed state for a participant
   */
  getParticipantState(userId) {
    if (!this.isParticipant(userId)) {
      return null;
    }
    
    return {
      isTalking: this.isTalking(userId),
      isMuted: this.isMuted(userId),
      hasNoMic: this.hasNoMic(userId)
    };
  }
  
  /**
   * Broadcast voice participants list to all clients
   */
  broadcastParticipantsList(wss) {
    try {
      const participants = this.getParticipants();
      
      // Create a detailed list with states
      const detailedParticipants = participants.map(userId => ({
        userId,
        isTalking: this.isTalking(userId),
        isMuted: this.isMuted(userId),
        noMic: this.hasNoMic(userId)
      }));
      
      // Create the message
      const message = JSON.stringify({
        type: 'voiceParticipants',
        participants,
        detailedParticipants
      });
      
      // Send to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (error) {
            console.error('Error sending voice participants list to client:', error);
          }
        }
      });
      
      console.log(`Broadcasted voice participants list with ${participants.length} users to all clients`);
    } catch (error) {
      console.error('Error broadcasting voice participants list:', error);
    }
  }
}

module.exports = VoiceManager;