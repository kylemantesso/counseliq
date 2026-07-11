# Build context must be the REPO ROOT (the converter depends on the
# @counseliq/course-schema workspace package):
#   docker build -f services/converter/Dockerfile .
#   fly deploy --config services/converter/fly.toml --dockerfile services/converter/Dockerfile .
FROM node:22-slim

# LibreOffice for pptx->pdf, poppler-utils for pdftoppm/pdfinfo/pdfimages,
# ffmpeg for asset ingestion (video transcode, posters, image resizing).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    poppler-utils \
    ffmpeg \
    fonts-liberation \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Install with the workspace lockfile; all workspace package.json files must
# be present for npm ci to resolve.
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/client-web/package.json apps/client-web/
COPY apps/client-mobile/package.json apps/client-mobile/
COPY packages/ui/package.json packages/ui/
COPY packages/admin/package.json packages/admin/
COPY packages/client/package.json packages/client/
COPY packages/course-schema/package.json packages/course-schema/
COPY services/converter/package.json services/converter/
RUN npm ci --workspace=@counseliq/converter --ignore-scripts

COPY packages/course-schema packages/course-schema
COPY services/converter services/converter

WORKDIR /repo/services/converter
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
