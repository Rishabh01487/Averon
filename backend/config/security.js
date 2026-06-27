const helmet = require('helmet');
const cors = require('cors');

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',').map(s => s.trim());

function setupSecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://cdn.razorpay.com", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:", "https://lumberjack.razorpay.com", "https://api.razorpay.com", "https://cdn.razorpay.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    noSniff: true,
    ieNoOpen: true,
  }));

  app.use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));

  app.set('trust proxy', 1);
}

module.exports = { setupSecurity };
