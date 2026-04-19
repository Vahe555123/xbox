module.exports = {
  apps: [
    {
      name: 'xbox-api',
      cwd: '/var/www/xbox/server',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/pm2/xbox-api.err.log',
      out_file: '/var/log/pm2/xbox-api.out.log',
      merge_logs: true,
      time: true,
    },
  ],

  deploy: {
    production: {
      user: 'root',
      host: 'YOUR_SERVER_IP',
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_USER/YOUR_REPO.git',
      path: '/var/www/xbox',
      'pre-setup': '',
      'post-setup': 'bash deploy.sh',
      'pre-deploy-local': '',
      'post-deploy': 'bash deploy.sh',
      ssh_options: 'StrictHostKeyChecking=no',
    },
  },
};
