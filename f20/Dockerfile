FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN mkdir -p /app/hls_output

EXPOSE 3000 3001 40000-49999/udp

CMD ["node", "src/index.js"]
