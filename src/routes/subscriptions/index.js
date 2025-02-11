const express = require('express');
const createPendingRouter = require('./pending');
const createProcessRouter = require('./process');

function createSubscriptionRouter(subscriptionProcessor) {
  const router = express.Router();

  // Mount sub-routers
  router.use(createPendingRouter(subscriptionProcessor));
  router.use(createProcessRouter(subscriptionProcessor));

  return router;
}

module.exports = createSubscriptionRouter;