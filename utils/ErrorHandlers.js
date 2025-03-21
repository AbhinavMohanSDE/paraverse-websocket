/**
 * Setup global error handlers
 */
function setupErrorHandlers(serverState) {
  // Global error handling
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    serverState.incrementErrors();
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    serverState.incrementErrors();
  });
}

module.exports = {
  setupErrorHandlers
};