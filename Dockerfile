FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config
COPY data ./data
COPY public ./public
COPY presentation ./presentation
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["node", "src/server.js"]
