# Use Node.js 20 (LTS)
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY src/ ./src/

# Set environment variables
ENV NODE_ENV=production

# Start the server
CMD [ "npm", "start" ]