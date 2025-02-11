const pino = require('pino');

function getLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'debug',
    formatters: {
      level: (label) => ({ level: label }),
    },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  });
}

module.exports = { getLogger };