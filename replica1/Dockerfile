FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
# Source is bind-mounted at runtime — COPY is only for image build fallback
COPY . .
EXPOSE 3001
CMD ["npm", "run", "dev"]
