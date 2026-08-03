FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    apt-get update && \
    apt-get install -y --no-install-recommends fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*
COPY server.js ./
COPY report-export.js ./
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
