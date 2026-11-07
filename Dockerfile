FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    VLM_PROXY_HOST=0.0.0.0 \
    VLM_PROXY_PORT=8788 \
    STATIC_DIR=/app/app/dist

COPY server/package.json ./server/package.json
COPY server/server.mjs ./server/server.mjs
COPY app/dist ./app/dist

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
