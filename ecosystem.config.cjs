module.exports = {
  apps: [{
    name: 'cari-akpk',
    script: process.env.APP_ENTRY || '/home/miftah/projects/pdf-search/build/index.js',
    cwd: process.env.APP_CWD || '/home/miftah/projects/pdf-search',
    env: {
      PORT: process.env.PORT || 3010
    }
  }]
};
