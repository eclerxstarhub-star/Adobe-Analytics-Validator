FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        xvfb \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/reports/output

EXPOSE 3000

CMD ["xvfb-run", "-a", "node", "app.js"]