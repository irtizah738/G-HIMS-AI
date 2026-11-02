# Disposable synthetic egress probe. No application dependencies or secrets.
# Reuses the reviewed immutable linux/amd64 Docker Official Image baseline.
FROM node:24-alpine@sha256:4eefa1bfce4197942661ef9148247d779ddf1bb0ee006d3294a467609de60724
ENV NODE_ENV=production
WORKDIR /opt/helixis-lab-probe
COPY --chown=node:node egress-probe.mjs ./egress-probe.mjs
USER node
CMD ["node", "/opt/helixis-lab-probe/egress-probe.mjs"]
