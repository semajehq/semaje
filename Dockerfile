FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts

FROM dependencies AS app
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN mkdir -p /data/blobs /data/exports /data/logs
EXPOSE 3001
CMD ["npm", "run", "start"]

