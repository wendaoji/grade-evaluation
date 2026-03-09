FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV GRADE_EVAL_DB_PATH=/app/data/grade-evaluation.db
ENV GRADE_EVAL_SEED_PATH=/app/data/store.json

COPY package.json ./
COPY src ./src
COPY public ./public
COPY data ./data

EXPOSE 3000

CMD ["node", "src/server.js"]
