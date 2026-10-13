# syntax=docker/dockerfile:1

########################  deps  #############################################
# Only two runtime dependencies (express, cors) — SQLite is built into Node,
# so there is no native compilation step and nothing to break on musl.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

########################  runtime  ##########################################
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data

WORKDIR /app

# tini gives us proper PID 1 signal handling for graceful shutdown
RUN apk add --no-cache tini

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--no-warnings", "src/index.js"]
