FROM node:22-alpine

WORKDIR /app

COPY server/web.mjs ./web.mjs
COPY app/dist ./dist/admin
COPY client/dist ./dist/client
COPY gate/dist ./dist/gate

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web.mjs"]
