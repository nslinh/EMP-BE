FROM node:22.14.0-alpine3.21

WORKDIR /app

# Copy package files
COPY package*.json .

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Set PORT
ENV PORT=80

# Start app
CMD ["npm", "run start:prod"]