FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV PARSER_BASE_URL=https://boe-parser-415554190254.us-central1.run.app
ENV PG_CONNECTION_DIAGNOSTICS=true

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]