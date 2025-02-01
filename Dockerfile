FROM node:18-alpine AS builder
WORKDIR /usr/src/app
RUN apk add --no-cache git
COPY .npmrc ./ 
COPY package.json package-lock.json ./ 
RUN npm install && npm cache clean --force
COPY . .
RUN if [ -d .git ]; \
	then export SOURCE_VERSION=$(git rev-parse --short HEAD); \
	else export SOURCE_VERSION=$(head -n 1 VERSION); fi
ENV SOURCE_VERSION=$SOURCE_VERSION
RUN npm run build


FROM node:18-alpine AS runtime
WORKDIR /usr/src/app
COPY .npmrc ./ 
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /usr/src/app/dist /usr/src/app/dist
COPY --from=builder /usr/src/app/node_modules /usr/src/app/node_modules
ARG SERVER_PORT=3030
ENV SERVER_PORT=${SERVER_PORT}


FROM runtime AS server
EXPOSE ${SERVER_PORT}
CMD ["sh", "-c", "node dist/server/server.js --port=${SERVER_PORT}"]


FROM runtime AS worker
ARG SERVER_PORT=3030
ENV SERVER_URL="http://server:${SERVER_PORT}"
COPY deploy/worker-start.sh /usr/local/bin/worker-start.sh
RUN chmod +x /usr/local/bin/worker-start.sh
RUN apk add --no-cache postgresql-client
CMD ["/usr/local/bin/worker-start.sh"]
