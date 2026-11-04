FROM node:22.14.0-alpine
WORKDIR /app
COPY --chown=node:node probe.mjs ./probe.mjs
USER node
ENTRYPOINT ["node","/app/probe.mjs"]
