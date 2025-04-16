const pino = require('pino');

const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
const isDevelopment = process.env.NODE_ENV === 'development';

const loggerConfig = {
  level: LOG_LEVEL,
  messageKey: 'message',
  formatters: {
    level: (label) => ({ severity: label.toUpperCase() })
  },
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  }
};

// Only use pino-pretty in development
if (isDevelopment) {
  loggerConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  };
}

const logger = pino(loggerConfig);

module.exports = logger; 