FROM node:20-slim

# Update npm to latest to fix vulnerable transitive deps (tar, glob, cross-spawn)
RUN npm install -g npm@latest

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy server file
COPY server-cli.js ./server.js

# Expose port
EXPOSE 3456

# Run the server
CMD ["node", "server.js"]
