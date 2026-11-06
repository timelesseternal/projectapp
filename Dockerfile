FROM node:22-alpine
WORKDIR /app
COPY package.json server.cjs test.cjs integration-test.cjs ./
COPY dist ./dist
COPY example ./example
RUN mkdir -p /app/data
EXPOSE 4173
ENV PORT=4173
ENV HOST=0.0.0.0
CMD ["node", "server.cjs"]
