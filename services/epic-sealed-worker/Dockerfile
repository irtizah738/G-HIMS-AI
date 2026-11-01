# Isolated context; no Next.js application dependencies or runtime secrets.
# Pin reviewed upstream base image digest before release qualification.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /opt/helixis-epic-sealed
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "/opt/helixis-epic-sealed/server.mjs"]
