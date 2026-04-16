FROM node:20-alpine
WORKDIR /app
RUN npm install -g nodemon
COPY package.json .
RUN npm install --include=dev
COPY . .
EXPOSE 3000
CMD ["nodemon", "index.js"]