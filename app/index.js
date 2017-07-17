const koa = require('koa');
const router = require('koa-router')();
const cors = require('koa-cors');
const logger = require('koa-logger');
const body = require('koa-better-body');

const config = require('./config');
const HttpError = require('./models/HttpError');
const Transaction = require('./models/Transaction');
const app = koa();

function *executeWorker() {
  try {
    yield Transaction.transactionWorker();
  } catch(error) {
    console.error(error);
  }
}

function executeSequence() {
  let generator = executeWorker();
  generator.next();
  setTimeout(executeSequence, 2 * 60 * 1000);
}

require('koa-qs')(app, 'extended');
app.use(logger());
app.use(cors());
app.use(body());

app.use(require('./controllers/Common').routes());

app.server = app.listen(config.port, () => {
    console.log('Server started on 127.0.0.1:' + config.port);

    executeSequence();
});