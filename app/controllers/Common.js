'use strict';

const Router = require('koa-router');

const Tournament = require('../models/Tournament');
const Player = require('../models/Player');
const HttpError = require('../models/HttpError');
const DB = require('../models/DB');

const router = new Router();
const player = new Player();
const tournament = new Tournament();

function errorResponse(error) {
  console.error(error);
  this.status = error.status || 500;
  this.body = error.message;
  this.type = 'text/plain; charset=utf-8';
};

router.get('/fund', function *() {
  try {
    yield player.fund(this.query);

    this.status = 200;
    this.body = 'Fund Successfull';
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/take', function *() {
  try {
    yield player.take(this.query);

    this.status = 200;
    this.body = 'Withdrawal Successfull';
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/balance', function *() {
  try {
    let accountInfo = yield player.balance(this.query);

    this.status = 200;
    this.body = accountInfo;
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/announceTournament', function *() {
  try {
    yield tournament.announceTournament(this.query);

    this.status = 200;
    this.body = 'Announce Tournament Successfull';
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/joinTournament', function *() {
  try {
    yield tournament.joinTournament(this.query);

    this.status = 200;
    this.body = 'Join Tournament Successfull';
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.post('/resultTournament', function *() {
  try {
    yield tournament.resultTournament(this.request.fields);

    this.status = 200;
    this.body = 'Tournament Completed Successfull';
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/reset', function *() {
  try {
    yield DB.resetDB();

    this.status = 200;
    this.body = 'Database Reset Successfull';
  } catch(error) {
    errorResponse.bind(this)(new HttpError(404, 'Database Reset Failure'));
  }
});

router.get('/players', function *() {
  try {
    let players = yield Player.findPlayers();

    this.status = 200;
    this.body = players;
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

router.get('/tournament', function *() {
  try {
    let tournament = yield Tournament.findTournament(this.query.tournamentId);

    this.status = 200;
    this.body = tournament;
  } catch(error) {
    errorResponse.bind(this)(error);
  }
});

module.exports = router;
