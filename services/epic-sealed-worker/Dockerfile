# Isolated synthetic Epic staging worker. No Next.js app or runtime secrets.
# Upstream Docker Official Image, linux/amd64 manifest (inspected 2026-11-01).
# The multi-platform index is sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85.
# Explicit linux/amd64 manifest prevents mutable tag drift and architecture ambiguity.
FROM node:24-alpine@sha256:4eefa1bfce4197942661ef9148247d779ddf1bb0ee006d3294a467609de60724
ENV NODE_ENV=production
WORKDIR /opt/helixis-epic-sealed
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "/opt/helixis-epic-sealed/server.mjs"]
