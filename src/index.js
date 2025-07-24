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
const { errorHandler } = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { createInvoice } = require("./services/xeroService");

const app = express();
const PORT = process.env.PORT;

// console log the environment variables onl
console.log(process.env.VITE_XERO_CLIENT_ID);


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

// API Request Logging Middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);

  // Add request ID to request object for tracking
  req.requestId = requestId;

  // Log incoming request
  logger.info(`[${requestId}] ${req.method} ${req.originalUrl}`, {
    requestId,
    method: req.method,
    url: req.originalUrl,
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function (data) {
    const responseTime = Date.now() - startTime;

    // Log response
    logger.info(
      `[${requestId}] Response ${res.statusCode} - ${responseTime}ms`,
      {
        requestId,
        statusCode: res.statusCode,
        responseTime,
        method: req.method,
        url: req.originalUrl,
      }
    );

    return originalJson.call(this, data);
  };

  // Override res.send to log response
  const originalSend = res.send;
  res.send = function (data) {
    const responseTime = Date.now() - startTime;

    // Log response
    logger.info(
      `[${requestId}] Response ${res.statusCode} - ${responseTime}ms`,
      {
        requestId,
        statusCode: res.statusCode,
        responseTime,
        method: req.method,
        url: req.originalUrl,
      }
    );

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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Enhanced Error Logging Middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || "unknown";

  // Log detailed error information
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
    timestamp: new Date().toISOString(),
  });

  // Call the original error handler
  errorHandler(err, req, res, next);
});

// 404 handler with logging
app.use("*", (req, res) => {
  const requestId = req.requestId || "unknown";

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

// Global uncaught exception handler
process.on("uncaughtException", (err) => {
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

// Global unhandled rejection handler
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection:", {
    reason: reason,
    promise: promise,
  });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV,
    corsOrigin: process.env.FRONTEND_URL,
  });
});

module.exports = app;
