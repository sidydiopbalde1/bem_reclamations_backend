// Configuration PM2 : pm2 startOrReload ecosystem.config.js
// Les variables (DATABASE_URL, JWT_SECRET…) sont lues dans le .env du dossier.
module.exports = {
  apps: [
    {
      name: 'registre-api',
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
