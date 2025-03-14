FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start app
CMD ["node", "src/index.js"]