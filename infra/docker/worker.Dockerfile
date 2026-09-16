FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY services/worker/package*.json ./services/worker/

RUN npm install

COPY packages/shared ./packages/shared
COPY services/worker ./services/worker

RUN npm run build -w @vulnlab/shared
RUN npm run build -w @vulnlab/worker

WORKDIR /app/services/worker

CMD ["node", "dist/consumer.js"]