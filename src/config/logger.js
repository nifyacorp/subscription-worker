const pino = require('pino');

function getLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

module.exports = { getLogger };