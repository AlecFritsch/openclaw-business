/** PM2 config for OpenClaw Business Backend — loads .env from backend/ */
module.exports = {
  apps: [
    {
      name: 'openclaw-business-backend',
      script: 'dist/index.js',
      cwd: __dirname,
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
  ],
};
