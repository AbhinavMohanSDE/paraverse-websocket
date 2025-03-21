/**
 * Manager for chat message handling
 */
class ChatManager {
  constructor() {
    // Store chat messages
    this.messages = [];
    
    // Maximum number of messages to store
    this.maxMessages = 100;
  }
  
  /**
   * Add a new chat message
   */
  addMessage(userId, userName, text) {
    // Generate message ID
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Create message object
    const message = {
      id: messageId,
      userId,
      userName,
      text,
      timestamp: new Date().toISOString()
    };
    
    // Add to messages array
    this.messages.push(message);
    
    // Trim messages if we exceed max
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages);
    }
    
    return message;
  }
  
  /**
   * Get chat history
   */
  getChatHistory() {
    return this.messages;
  }
  
  /**
   * Broadcast a message to all connected clients
   */
  broadcastMessage(wss, message, excludeWs = null) {
    const WebSocket = require('ws');
    
    // Create the message packet
    const messagePacket = JSON.stringify({
      type: 'chatMessage',
      message
    });
    
    // Send to all connected clients
    wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        try {
          client.send(messagePacket);
        } catch (error) {
          console.error('Error broadcasting chat message:', error);
        }
      }
    });
  }
  
  /**
   * Send chat history to a specific client
   */
  sendChatHistory(ws) {
    try {
      // Create history packet
      const historyPacket = JSON.stringify({
        type: 'chatHistory',
        messages: this.messages
      });
      
      // Send to client
      ws.send(historyPacket);
    } catch (error) {
      console.error('Error sending chat history:', error);
    }
  }
}

module.exports = ChatManager;