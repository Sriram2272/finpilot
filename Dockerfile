FROM node:22-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./

RUN npm ci

COPY client/ ./

RUN npm run build

# Stage 2
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

COPY . .
RUN rm -rf node_modules client

RUN npm ci --omit=dev

COPY --from=client-builder /app/client/dist ./client/dist

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "index.js"]

