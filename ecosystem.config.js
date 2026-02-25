module.exports = {
  apps: [
    {
      name: 'btb-backend',
      cwd: './backend',
      script: 'server.js',
      args: '',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        ALLOW_ALL_CORS: 'true'
      }
    },
    {
      name: 'btb-frontend',
      cwd: './frontend',
      // Serve the production build via the included serve-build helper. This is more
      // reliable under PM2 than running the CRA dev server.
      script: 'scripts/serve-build.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    }
  ]
};
