module.exports = {
  name: 'Liflang Tournament Test Application',
  port: process.env.PORT || 3003,

  db: {
    name: process.env.DB_NAME || 'lifland',
    host: process.env.MONGO_DB_HOST,
    port: process.env.MONGO_DB_PORT
  }
};
