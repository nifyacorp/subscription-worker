import pg from 'pg';
const { Pool } = pg;

export class DatabaseClient {
  constructor() {
    this.pool = new Pool({
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.INSTANCE_CONNECTION_NAME
        ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
        : 'localhost'
    });
  }

  async getActiveSubscriptionsGroupedByType() {
    const query = `
      SELECT 
        s.id,
        s.user_id,
        s.type,
        s.prompts,
        s.active
      FROM subscriptions s
      WHERE s.active = true
      ORDER BY s.type, s.user_id
    `;

    const { rows } = await this.pool.query(query);
    
    return rows.reduce((acc, sub) => {
      if (!acc[sub.type]) {
        acc[sub.type] = [];
      }
      acc[sub.type].push(sub);
      return acc;
    }, {});
  }

  async createNotification({ userId, subscriptionId, content, type }) {
    const query = `
      INSERT INTO notifications (user_id, subscription_id, content, type)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const { rows } = await this.pool.query(query, [
      userId,
      subscriptionId,
      content,
      type
    ]);

    return rows[0];
  }
}