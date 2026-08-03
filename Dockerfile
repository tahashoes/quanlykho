FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
