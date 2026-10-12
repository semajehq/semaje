FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts

FROM dependencies AS build
ARG VITE_AUTH_MODE=single-user
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE
COPY . .
RUN npm run build

FROM dependencies AS app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /data/blobs /data/exports /data/logs
EXPOSE 3001
CMD ["npm", "run", "start"]

FROM nginx:1.27-alpine AS frontend
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
