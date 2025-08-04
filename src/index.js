require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
// Fix: Import the strategy correctly
const { Strategy: XeroStrategy } = require("passport-xero-oauth2");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const dashboardRoutes = require("./routes/dashboard");
const invoiceRoutes = require("./routes/invoices");
const uploadRoutes = require("./routes/upload");
const xeroRoutes = require("./routes/xero");
const { errorHandler } = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { createInvoice } = require("./services/xeroService");

const app = express();
const PORT = process.env.PORT;

// CORS configuration
app.use(cors({
  origin: [
    'https://invoicemanager.kaifoundry.com',
    'http://localhost:3000', // for development
    'http://localhost:5173'  // for Vite dev server
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info("Created uploads directory");
}

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Express session setup (must be before passport)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "xero-session-secret",
    resave: false,
    saveUninitialized: false, // Changed to false for better security
    cookie: {
      secure: process.env.NODE_ENV === "production", // Only use secure cookies in production
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport session setup
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Enhanced API Request Logging Middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  const timestamp = new Date().toISOString();

  // Add request ID to request object for tracking
  req.requestId = requestId;

  // Enhanced readable logging for incoming request
  const requestInfo = [
    `🚀 [${requestId}]`,
    `${req.method.padEnd(6)}`,
    `${req.originalUrl}`,
    `| ${timestamp}`,
    req.ip ? `| IP: ${req.ip}` : '',
    Object.keys(req.query).length > 0 ? `| Query: ${JSON.stringify(req.query)}` : '',
    req.headers['user-agent'] ? `| UA: ${req.headers['user-agent'].substring(0, 50)}...` : ''
  ].filter(Boolean).join(' ');

  console.log(`\n${requestInfo}`);

  // Log request body for POST/PUT requests (with size limit for readability)
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    const bodyStr = JSON.stringify(req.body);
    const truncatedBody = bodyStr.length > 500 ? bodyStr.substring(0, 500) + '...' : bodyStr;
    console.log(`📦 [${requestId}] Request Body: ${truncatedBody}`);
  }

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function (data) {
    const responseTime = Date.now() - startTime;
    const statusEmoji = res.statusCode >= 400 ? '❌' : res.statusCode >= 300 ? '🔄' : '✅';

    const responseInfo = [
      `${statusEmoji} [${requestId}]`,
      `${req.method.padEnd(6)}`,
      `${req.originalUrl}`,
      `| Status: ${res.statusCode}`,
      `| ${responseTime}ms`,
      `| ${new Date().toISOString()}`
    ].join(' ');

    console.log(responseInfo);

    // Log response data for errors or when explicitly needed
    if (res.statusCode >= 400) {
      const responseStr = JSON.stringify(data);
      const truncatedResponse = responseStr.length > 300 ? responseStr.substring(0, 300) + '...' : responseStr;
      console.log(`💬 [${requestId}] Response Data: ${truncatedResponse}`);
    }

    console.log(`─────────────────────────────────────────────────────────────`);

    return originalJson.call(this, data);
  };

  // Override res.send to log response
  const originalSend = res.send;
  res.send = function (data) {
    const responseTime = Date.now() - startTime;
    const statusEmoji = res.statusCode >= 400 ? '❌' : res.statusCode >= 300 ? '🔄' : '✅';

    const responseInfo = [
      `${statusEmoji} [${requestId}]`,
      `${req.method.padEnd(6)}`,
      `${req.originalUrl}`,
      `| Status: ${res.statusCode}`,
      `| ${responseTime}ms`,
      `| ${new Date().toISOString()}`
    ].join(' ');

    console.log(responseInfo);

    // Log response data for errors or when explicitly needed
    if (res.statusCode >= 400 && typeof data === 'string') {
      const truncatedData = data.length > 300 ? data.substring(0, 300) + '...' : data;
      console.log(`💬 [${requestId}] Response Data: ${truncatedData}`);
    }

    console.log(`─────────────────────────────────────────────────────────────`);

    return originalSend.call(this, data);
  };

  next();
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/xero", xeroRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Enhanced Error Logging Middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || "unknown";
  const timestamp = new Date().toISOString();

  // Enhanced readable error logging
  console.log(`\n🔥 ERROR OCCURRED 🔥`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`📍 Request ID: ${requestId}`);
  console.log(`🕐 Timestamp: ${timestamp}`);
  console.log(`🌐 Method: ${req.method} | URL: ${req.originalUrl}`);
  console.log(`❌ Error Name: ${err.name}`);
  console.log(`💥 Error Message: ${err.message}`);
  console.log(`🔢 Status Code: ${err.status || err.statusCode || 500}`);

  if (err.code) {
    console.log(`🏷️  Error Code: ${err.code}`);
  }

  console.log(`📚 Stack Trace:`);
  console.log(err.stack);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // Also keep the structured logging for log files
  logger.error(`[${requestId}] API Error`, {
    requestId,
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code,
      status: err.status || err.statusCode || 500,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
    },
    timestamp,
  });

  // Call the original error handler
  errorHandler(err, req, res, next);
});

// Enhanced 404 handler
app.use("*", (req, res) => {
  const requestId = req.requestId || "unknown";
  const timestamp = new Date().toISOString();

  console.log(`\n🔍 404 - ROUTE NOT FOUND`);
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(`📍 Request ID: ${requestId}`);
  console.log(`🕐 Timestamp: ${timestamp}`);
  console.log(`🌐 Method: ${req.method} | URL: ${req.originalUrl}`);
  console.log(`💡 Available routes might be checked in your route files`);
  console.log(`────────────────────────────────────────────────────────────\n`);

  // Keep structured logging for files
  logger.warn(
    `[${requestId}] Route not found: ${req.method} ${req.originalUrl}`,
    {
      requestId,
      method: req.method,
      url: req.originalUrl,
    }
  );

  res.status(404).json({
    error: "Route not found",
    requestId,
    method: req.method,
    path: req.originalUrl,
  });
});

// Enhanced global exception handlers
process.on("uncaughtException", (err) => {
  console.log(`\n💀 UNCAUGHT EXCEPTION 💀`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
  console.log(`❌ Error Name: ${err.name}`);
  console.log(`💥 Error Message: ${err.message}`);
  console.log(`📚 Stack Trace:`);
  console.log(err.stack);
  console.log(`🚨 Process will exit...`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  logger.error("Uncaught Exception:", {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
    },
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.log(`\n⚠️  UNHANDLED PROMISE REJECTION ⚠️`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
  console.log(`💥 Reason: ${reason}`);
  console.log(`📝 Promise: ${promise}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  logger.error("Unhandled Rejection:", {
    reason: reason,
    promise: promise,
  });
});

// Enhanced server start logging
app.listen(PORT, () => {
  console.log(`\n🚀 SERVER STARTED SUCCESSFULLY 🚀`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌍 CORS Origins: ${process.env.FRONTEND_URL || 'localhost'}`);
  console.log(`🕐 Started at: ${new Date().toISOString()}`);
  console.log(`📝 Logs: Both console and file logging active`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  logger.info(`Server running on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV,
    corsOrigin: process.env.FRONTEND_URL,
  });
});

module.exports = app;