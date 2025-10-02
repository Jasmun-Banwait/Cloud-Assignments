
FROM node:22

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install
# If you are building your code for production

COPY app.js app.js

EXPOSE  3000
CMD [ "npm", "start" ]




