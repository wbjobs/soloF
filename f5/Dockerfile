FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 4000 4001 4002 4003

CMD ["node", "gateway/index.js"]
