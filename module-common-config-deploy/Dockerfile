FROM node:22-alpine
RUN apk add --no-cache tzdata

WORKDIR /app
COPY . .

RUN corepack enable
RUN yarn install --immutable

CMD ["node", "./main.mjs"]
