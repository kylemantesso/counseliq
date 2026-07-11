# Build context must be the REPO ROOT:
#   docker build -f services/renderer/Dockerfile .
#   fly deploy --config services/renderer/fly.toml --dockerfile services/renderer/Dockerfile .
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    fontconfig \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/client-web/package.json apps/client-web/
COPY apps/client-mobile/package.json apps/client-mobile/
COPY packages/ui/package.json packages/ui/
COPY packages/admin/package.json packages/admin/
COPY packages/client/package.json packages/client/
COPY packages/cards/package.json packages/cards/
COPY packages/course-schema/package.json packages/course-schema/
COPY services/converter/package.json services/converter/
COPY services/renderer/package.json services/renderer/
RUN npm ci --workspace=@counseliq/renderer --ignore-scripts

COPY packages/cards packages/cards
COPY packages/course-schema packages/course-schema
COPY services/renderer services/renderer

WORKDIR /repo/services/renderer
ENV NODE_ENV=production
EXPOSE 8081
CMD ["npx", "tsx", "src/index.ts"]
