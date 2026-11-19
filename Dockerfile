# syntax=docker/dockerfile:1

# Stage 1: dependensi produksi saja.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && rm -rf node_modules/.bin node_modules/.package-lock.json

# Stage 2: build aset frontend.
FROM node:24-alpine AS build
ARG VITE_SHOW_DEMO_LOGIN=false
ENV VITE_SHOW_DEMO_LOGIN=${VITE_SHOW_DEMO_LOGIN}
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 3: runtime nginx dan API Express dalam satu image.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache nginx su-exec \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx \
              /opt/yarn* \
    && rm -rf /usr/share/nginx/html

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY --from=build /app/dist ./dist
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploy/verify /usr/local/bin/verify

RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/verify/*.sh \
    && mkdir -p /app/server/storage \
    && chown -R node:node /app/server/storage

EXPOSE 80

# Stage 4a: verifikasi dependensi.
FROM runtime AS verify-deps
RUN /usr/local/bin/verify/deps.sh \
    && touch /tmp/verified-deps

# Stage 4b: verifikasi layout berkas.
FROM runtime AS verify-layout
RUN /usr/local/bin/verify/layout.sh \
    && touch /tmp/verified-layout

# Stage 5: gabungkan hasil verifikasi, lalu bersihkan alat verifikasi.
FROM runtime AS verify
COPY --from=verify-deps /tmp/verified-deps /tmp/verified-deps
COPY --from=verify-layout /tmp/verified-layout /tmp/verified-layout
RUN rm -rf /usr/local/bin/verify /tmp/verified-deps /tmp/verified-layout

# Stage 6: image akhir.
FROM verify AS app
CMD ["/usr/local/bin/entrypoint.sh"]
