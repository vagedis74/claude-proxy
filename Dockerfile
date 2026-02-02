FROM node:20-alpine

# Update npm to latest and patch vulnerable tar in npm's bundled deps
RUN npm install -g npm@latest \
    && npm install -g tar@latest \
    && NPM_DIR=$(dirname $(which npm))/../lib/node_modules/npm \
    && rm -rf $NPM_DIR/node_modules/tar \
    && ln -s $(npm root -g)/tar $NPM_DIR/node_modules/tar

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
