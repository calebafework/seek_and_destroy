FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY services/orchestrator/package*.json ./services/orchestrator/

RUN npm install

COPY packages/shared ./packages/shared
COPY services/orchestrator ./services/orchestrator

RUN npm run build -w @vulnlab/shared
RUN npm run build -w @vulnlab/orchestrator

WORKDIR /app/services/orchestrator

CMD ["node", "dist/server.js"]