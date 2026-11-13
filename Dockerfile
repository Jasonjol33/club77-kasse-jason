FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json server.js docker-entrypoint.sh ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public
RUN chmod +x docker-entrypoint.sh && mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
# Der Entrypoint setzt die Rechte auf dem (als root gemounteten) Fly-Volume und startet die App als User "node".
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
