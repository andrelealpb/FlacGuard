FROM node:20-alpine

# FFmpeg for motion detection (frame extraction) and recording
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

# Embed build info (git commit, branch, timestamp)
ARG BUILD_COMMIT=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_AUTHOR=unknown
ARG BUILD_MESSAGE=unknown
RUN echo "{\"commit\":\"${BUILD_COMMIT}\",\"branch\":\"${BUILD_BRANCH}\",\"built_at\":\"${BUILD_TIMESTAMP}\",\"commit_author\":\"${BUILD_AUTHOR}\",\"commit_message\":\"${BUILD_MESSAGE}\"}" > /app/build-info.json

EXPOSE 8000

CMD ["node", "src/index.js"]
