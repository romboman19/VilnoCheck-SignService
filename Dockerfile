FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev
EXPOSE 3017
CMD ["npm", "start"]
