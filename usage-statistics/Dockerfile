FROM node:22-alpine
RUN apk add --no-cache tzdata

WORKDIR /app
COPY . .

RUN corepack enable
RUN yarn install --immutable
RUN cp .env.example .env
RUN yarn build
RUN rm .env.* .env

CMD ["node", "dist/main.js"]

