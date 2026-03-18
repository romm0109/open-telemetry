/**
 * service-b.js  —  Data Service (port 3002) — GraphQL
 *
 * Exposes a GraphQL endpoint at POST /graphql.
 * Resolves the `dbTime` query by running SELECT NOW() against Postgres.
 *
 * The OTel HTTP instrumentation reads the traceparent header forwarded by
 * Service A and automatically resumes the same trace (same trace_id, new
 * child span_id). The pg instrumentation adds a child DB span automatically.
 */

"use strict";

const express = require("express");
const winston = require("winston");
const { OpenTelemetryTransportV3 } = require("@opentelemetry/winston-transport");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@apollo/server/express4");
const bodyParser = require("body-parser");

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new OpenTelemetryTransportV3(),
  ],
});

// ---------------------------------------------------------------------------
// GraphQL schema + resolvers
// ---------------------------------------------------------------------------
const typeDefs = `
  type User {
    id: ID
    name: String
    email: String
  }

  type Query {
    dbTime: String
    users: [User]
  }
`;

const USERS = [
  { id: "1", name: "Alice", email: "alice@example.com" },
  { id: "2", name: "Bob", email: "bob@example.com" },
];

const resolvers = {
  Query: {
    dbTime: async (_parent, _args, context) => {
      logger.info("Service B: resolving dbTime query", {
        traceparent: context.traceparent ?? null,
      });
      throw new Error("Simulated failure in dbTime resolver");
    },
    users: async (_parent, _args, context) => {
      logger.info("Service B: resolving users query", {
        traceparent: context.traceparent ?? null,
      });
      return USERS;
    },
  },
  // Explicit field resolvers on User — these should be filtered out by ignoreResolveSpans
  User: {
    id: (parent) => parent.id,
    name: (parent) => parent.name,
    email: (parent) => parent.email,
  },
};

// ---------------------------------------------------------------------------
// Express + Apollo Server
// ---------------------------------------------------------------------------
const app = express();
const PORT = 3002;

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();

  app.use(
    "/graphql",
    bodyParser.json(),
    expressMiddleware(server, {
      // Pass the raw traceparent header into GraphQL context so resolvers can log it.
      context: async ({ req }) => ({
        traceparent: req.headers["traceparent"] ?? null,
      }),
    })
  );

  app.listen(PORT, () => {
    logger.info(`Service B listening (GraphQL at /graphql)`, { port: PORT });
  });
}

start().catch((err) => {
  logger.error("Service B: failed to start", { error: err.message });
  process.exit(1);
});
