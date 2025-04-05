const { getLogger } = require('../../config/logger');
const logger = getLogger('subscription-pending');

async function getPendingSubscriptions(pool) {
  logger.debug({
    phase: 'start',
    timestamp: new Date().toISOString()
  }, 'Starting to fetch pending subscriptions');

  const client = await pool.connect();
  
  try {
    logger.debug({
      phase: 'query_start',
      query: `SELECT 
        sp.id as processing_id,
        sp.subscription_id,
        sp.status,
        sp.next_run_at,
        sp.last_run_at,
        sp.metadata,
        sp.error,
        s.user_id,
        s.type_id,
        st.name as type_name,
        s.active,
        s.prompts,
        s.frequency,
        s.last_check_at,
        s.created_at,
        s.updated_at
      FROM subscription_processing sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      JOIN subscription_types st ON st.id = s.type_id
      ORDER BY sp.next_run_at ASC`.trim()
    }, 'Executing pending subscriptions query');

    const queryStartTime = Date.now();
    const result = await client.query(`
      SELECT 
        sp.id as processing_id,
        sp.subscription_id,
        sp.status,
        sp.next_run_at,
        sp.last_run_at,
        sp.metadata,
        sp.error,
        s.user_id,
        s.type_id,
        st.name as type_name,
        s.active,
        s.prompts,
        s.frequency,
        s.last_check_at,
        s.created_at,
        s.updated_at
      FROM subscription_processing sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      JOIN subscription_types st ON st.id = s.type_id
      ORDER BY sp.next_run_at ASC
    `);
    const queryTime = Date.now() - queryStartTime;

    logger.debug({
      phase: 'query_complete',
      query_time_ms: queryTime,
      rows_found: result.rows.length,
      first_subscription: result.rows[0] ? {
        id: result.rows[0].id,
        subscription_id: result.rows[0].subscription_id,
        status: result.rows[0].status,
        next_run_at: result.rows[0].next_run_at,
        last_run_at: result.rows[0].last_run_at,
        active: result.rows[0].active,
        type_id: result.rows[0].type_id,
        metadata: result.rows[0].metadata,
        error: result.rows[0].error
      } : null,
      current_timestamp: new Date().toISOString()
    }, 'Pending subscriptions query results');

    return result.rows;
  } finally {
    client.release();
  }
}

function createPendingRouter(subscriptionProcessor) {
  const router = require('express').Router();

  router.get('/pending-subscriptions', async (req, res) => {
    try {
      const subscriptions = await getPendingSubscriptions(subscriptionProcessor.pool);
      
      const response = {
        subscriptions,
        count: subscriptions.length
      };

      logger.debug({
        phase: 'response_ready',
        response_size: JSON.stringify(response).length,
        subscription_count: response.count
      }, 'Preparing response');

      res.status(200).json(response);
    } catch (error) {
      logger.error({ 
        error,
        errorName: error.name,
        errorCode: error.code,
        errorMessage: error.message,
        errorStack: error.stack,
        phase: 'error'
      }, 'Failed to fetch pending subscriptions');
      
      res.status(500).json({ 
        error: 'Failed to fetch pending subscription actions'
      });
    }
  });

  return router;
}

module.exports = createPendingRouter;