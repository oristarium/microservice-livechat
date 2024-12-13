FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Expose WebSocket port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"] 