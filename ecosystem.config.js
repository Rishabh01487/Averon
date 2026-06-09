// ══════════════════════════════════════════════════════════════════════════════
// AVERON — PM2 Ecosystem Configuration
// ══════════════════════════════════════════════════════════════════════════════
// Start with:  pm2 start ecosystem.config.js
// Monitor:     pm2 monit
// Logs:        pm2 logs
// Reload:      pm2 reload ecosystem.config.js
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  apps: [{
    name: 'averon',
    script: 'server.js',
    instances: process.env.CLUSTER_WORKERS || 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 4200,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 4200,
      CLUSTER: 'true',
    },
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_restarts: 10,
    restart_delay: 4000,
    watch: false,
    kill_timeout: 10000,
    listen_timeout: 8000,
    shutdown_with_message: true,
  }],
};
