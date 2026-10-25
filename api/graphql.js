import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs, resolvers, initDb } from '../backend/server.js';

const app = express();
app.use(cors());
app.use(express.json());

let apolloServer = null;
let dbInitialized = false;

async function getApolloHandler() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
  if (!apolloServer) {
    apolloServer = new ApolloServer({ typeDefs, resolvers });
    await apolloServer.start();
  }
  return expressMiddleware(apolloServer);
}

app.use(async (req, res, next) => {
  try {
    const handler = await getApolloHandler();
    return handler(req, res, next);
  } catch (err) {
    return next(err);
  }
});

export default app;
