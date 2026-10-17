FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production APP_MODE=accounts HOST=0.0.0.0 PORT=4310 QINGDAN_DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/LICENSE ./LICENSE
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/docs ./docs
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 4310
CMD ["node", "dist/server/main.mjs"]
