FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock bunfig.toml ./
RUN bun install
COPY . .
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NITRO_HOST=0.0.0.0 NITRO_PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
