# Build context must be the REPO ROOT (the converter depends on the
# @counseliq/course-schema workspace package):
#   docker build -f services/converter/Dockerfile .
#   fly deploy --config services/converter/fly.toml --dockerfile services/converter/Dockerfile .
FROM node:22-slim

# LibreOffice for pptx->pdf, poppler-utils for pdftoppm/pdfinfo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    poppler-utils \
    fonts-liberation \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Install with the workspace lockfile; all workspace package.json files must
# be present for npm ci to resolve.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/ui/package.json packages/ui/
COPY packages/app/package.json packages/app/
COPY packages/course-schema/package.json packages/course-schema/
COPY services/converter/package.json services/converter/
RUN npm ci --workspace=@counseliq/converter --ignore-scripts

COPY packages/course-schema packages/course-schema
COPY services/converter services/converter

WORKDIR /repo/services/converter
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
