/**
 * Legacy Routes
 * Provides backward compatibility with older endpoints
 */
const express = require('express');

function createLegacyRouter(options) {
  const { subscriptionProcessor } = options;
  const router = express.Router();

  /**
   * Legacy endpoint for processing subscriptions
   * Redirects to the standard API endpoint
   */
  router.post('/process-subscription/:id', (req, res) => {
    const newPath = `/api/subscriptions/process/${req.params.id}`;
    console.info(`Legacy endpoint /process-subscription/:id called, redirecting to ${newPath}`);
    res.redirect(307, newPath);
  });

  /**
   * Handle other legacy endpoints
   * Add any other legacy routes here as needed
   */
  
  return router;
}

module.exports = createLegacyRouter;