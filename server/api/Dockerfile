FROM node:20-alpine

# FFmpeg for motion detection (frame extraction) and recording
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

EXPOSE 8000

CMD ["node", "src/index.js"]
