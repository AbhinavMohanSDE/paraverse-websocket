const WebSocket = require('ws');

class GameChatManager {
  constructor() {
    // We don't store any chat history as per requirements
    // This is just for real-time message broadcasting
  }

  /**
   * Broadcast a game chat message to all connected clients except the sender
   * @param {WebSocketServer} wss - The WebSocket server instance
   * @param {Object} message - The game chat message object
   * @param {WebSocket} senderWs - The WebSocket connection of the sender (to exclude)
   */
  broadcastGameMessage(wss, message, senderWs) {
    try {
      const formattedMessage = {
        type: 'gameChat',
        message: {
          userId: message.userId,
          userName: message.userName,
          text: message.text,
          timestamp: Date.now()
        }
      };

      wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(formattedMessage));
        }
      });

      console.log(`Game chat message from ${message.userName} (${message.userId}): ${message.text.substring(0, 50)}${message.text.length > 50 ? '...' : ''}`);
    } catch (error) {
      console.error('Error broadcasting game chat message:', error);
    }
  }

  /**
   * Send a direct game chat message to a specific client
   * @param {WebSocket} ws - The WebSocket connection to send the message to
   * @param {Object} message - The game chat message
   */
  sendDirectGameMessage(ws, message) {
    try {
      const formattedMessage = {
        type: 'gameChat',
        message: {
          userId: message.userId,
          userName: message.userName,
          text: message.text,
          timestamp: Date.now()
        }
      };

      ws.send(JSON.stringify(formattedMessage));
    } catch (error) {
      console.error('Error sending direct game chat message:', error);
    }
  }
}

module.exports = GameChatManager;