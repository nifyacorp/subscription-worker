FROM node:18-slim

# Install dependencies for Cloud SQL Auth proxy
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

# Download and install the Cloud SQL Auth proxy
RUN wget https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64 -O /cloud_sql_proxy \
    && chmod +x /cloud_sql_proxy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Create directory for Cloud SQL
RUN mkdir -p /cloudsql

# Expose port
EXPOSE 8080

# Start the Cloud SQL Auth proxy and the application
CMD /cloud_sql_proxy -dir=/cloudsql -instances=${INSTANCE_CONNECTION_NAME} & npm start