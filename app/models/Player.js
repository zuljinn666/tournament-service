'use strict';

const co = require('co');

const HttpError = require('./HttpError');
const DB = require('./DB');
const Transaction = require('./Transaction');

class Player {
  static get schema() {
    return {
      player_id: {type: 'string', unique: true},
      balance: {type: 'float'},
      frozen: {
        type: 'subschema',
        array: true,
        schema: {
          transaction_id: {type: 'id'},
          applied: {type: 'boolean'},
          action: {type: 'string'},
          points: {type: 'float'}
        }
      },
      transactions: {
        type: 'subschema',
        array: true,
        schema: {
          transaction_id: {type: 'id'},
          state: {type: 'string'},
          action: {type: 'string'},
          points: {type: 'float'}
        }
      }
    }
  }

  static validatePlayer(player) {
    let err;
    if(typeof player != 'object') { err = true; }
    if(!player.playerId || !player.points || isNaN(parseFloat(player.points))) { err = true; }

    if (err) { throw new HttpError(400, 'Player Data Validation Failed'); }

    let playerData = {
      player_id: player.playerId,
      points: parseFloat(player.points)
    };

    return playerData;
  }

  static find(playerId) {
    return co(function *() {
      if (!playerId) { throw new HttpError(404, 'Player Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({_id: playerId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }

      return docs[0];
    }.bind(this));
  }

  static findPlayers() {
    return co(function *() {
      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({});

      if (!docs) { throw new HttpError(404, 'Players Not Found'); }

      return docs;
    }.bind(this));
  }

  update(player) {
    return co(function *() {
      if (!player._id) { throw new HttpError(404, 'Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let result = yield playerTable.update(player);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  getDocumentTransaction(player, transactionId, stateName) {
    let documentTransaction = {};

    player.transactions = player.transactions.map(transactionRecord => {
      if (transactionRecord.transaction_id.toString() == transactionId) {
        documentTransaction.completed = transactionRecord.state == stateName ? true : false;
        transactionRecord.state = stateName;
        documentTransaction.transactionDetails = transactionRecord;
      }

      return transactionRecord;
    });

    documentTransaction.player = player;

    return documentTransaction;
  }

  freeze(playerId, transactionId) {
    return co(function *() {
      if (!playerId) { throw new HttpError(404, 'Player Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({_id: playerId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }
      let player = docs[0];

      if (!player.transactions || !Array.isArray(player.transactions)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }
      if (!player.frozen || !Array.isArray(player.frozen)) { player.frozen = []; }

      let documentTransaction = this.getDocumentTransaction(player, transactionId, 'frozen');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      player = documentTransaction.player;

      if (!transactionDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }      
      if (completed) { return; }

      player.frozen.push({
        transaction_id: transactionDetails.transaction_id,
        action: transactionDetails.action,
        points: transactionDetails.points,
        applied: false
      });
      
      let result = yield playerTable.update(player);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  apply(playerId, transactionId) {
    return co(function *() {
      if (!playerId) { throw new HttpError(404, 'Player Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({_id: playerId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }
      let player = docs[0];

      if (!player.transactions || !Array.isArray(player.transactions) ||
          !player.frozen || !Array.isArray(player.frozen)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }

      let documentTransaction = this.getDocumentTransaction(player, transactionId, 'applied');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      player = documentTransaction.player;

      if (!transactionDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }      
      if (completed) { return; }

      let index;
      let freezeDetails;
      let iceberg = 0.00;

      player.frozen.map((freezeRecord, i) => {
        if (freezeRecord.action == 'fund' && freezeRecord.points && freezeRecord.applied == true) {
          iceberg = parseFloat(iceberg + freezeRecord.points).toFixed(2);
        }

        if (freezeRecord.transaction_id.toString() == transactionId) {
          freezeDetails = freezeRecord;
          index = i;
        }
      });

      if (!freezeDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }

      let action = freezeDetails.action;
      switch (action) {
        case 'take':
          if (player.balance < freezeDetails.points) {
            throw new HttpError(404, `Player ${player.player_id} - Not Enoug Points`);
          }

          let surplus = parseFloat(player.balance - freezeDetails.points).toFixed(2);
          if (surplus < iceberg) {
            throw new HttpError(404, `Player ${player.player_id} - Pending Transactions. Try Later`);
          }

          player.balance = parseFloat(player.balance - freezeDetails.points).toFixed(2);
          player.frozen[index].applied = true;
          break;

        case 'fund':
          player.balance = parseFloat(player.balance + freezeDetails.points).toFixed(2);
          player.frozen[index].applied = true;
          break;

        default:
          break;
      }
      
      let result = yield playerTable.update(player);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  rollback(playerId, transactionId) {
    return co(function *() {
      if (!playerId) { throw new HttpError(404, 'Player Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({_id: playerId});

      if (!docs || !docs.length) { return; }
      let player = docs[0];

      if (!player.transactions || !Array.isArray(player.transactions) ||
          !player.frozen || !Array.isArray(player.frozen)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }

      let documentTransaction = this.getDocumentTransaction(player, transactionId, 'rollbacked');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      player = documentTransaction.player;

      if (completed) { return; }

      let index;
      let freezeDetails;
      player.frozen.map((freezeRecord, i) => {
        if (freezeRecord.transaction_id.toString() == transactionId) {
          freezeDetails = freezeRecord;
          index = i;
        }
      });

      if (!freezeDetails) { return; }

      if (freezeDetails.applied === true) {
        let action = freezeDetails.action;
        switch (action) {
          case 'take':
            player.balance = parseFloat(player.balance + freezeDetails.points).toFixed(2);
            break;

          case 'fund':
            player.balance = parseFloat(player.balance - freezeDetails.points).toFixed(2);
            break;

          default:
            break;
        }

        player.frozen[index].applied = false;
      }

      let result = yield playerTable.update(player);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  fund(player) {
    return co(function *() {
      player = Player.validatePlayer(player);

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({player_id: player.player_id});

      let result;
      let doc = docs[0];
      if (docs && docs.length) {
        let transaction_operations = [];

        transaction_operations.push({
          document_id: doc._id,
          document_type: 'Player',
          action: 'fund|' + player.points
        });

        let transaction = {
          created: Date.now(),
          state: 'init',
          operations: transaction_operations
        };

        let transact = new Transaction();

        let transactionId = yield transact.createTransaction(transaction);

        yield transact.executeTransaction(transactionId);
      } else {
        result = yield playerTable.create({
          player_id: player.player_id,
          balance: player.points
        });
      }

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  take(player) {
    return co(function *() {
      player = Player.validatePlayer(player);

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({player_id: player.player_id});

      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }

      let result;
      let doc = docs[0];
      if (doc.balance < player.points) {
        throw new HttpError(404, 'Withdrawal Amount Is Too Large');
      } else {
        let transaction_operations = [];

        transaction_operations.push({
          document_id: doc._id,
          document_type: 'Player',
          action: 'take|' + player.points
        });

        let transaction = {
          created: Date.now(),
          state: 'init',
          operations: transaction_operations
        };

        let transact = new Transaction();

        let transactionId = yield transact.createTransaction(transaction);

        yield transact.executeTransaction(transactionId);

        result = yield playerTable.read({player_id: player.player_id});
      }

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  balance(player) {
    return co(function *() {
      if (!player.playerId) { throw new HttpError(404, 'Player Id Required'); }

      let playerTable = DB.init('Player', Player.schema);

      let docs = yield playerTable.read({player_id: player.playerId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }
      let doc = docs[0];

      let iceberg = 0.00;
      doc.frozen.map((freezeRecord, i) => {
        if (freezeRecord.action == 'fund' && freezeRecord.points && freezeRecord.applied == true) {
          iceberg = parseFloat(iceberg + freezeRecord.points).toFixed(2);
        }
      });

      let balance = {
        playerId: doc.player_id,
        balance: parseFloat(doc.balance - iceberg).toFixed(2)
      }

      return balance;
    }.bind(this));
  }
}

module.exports = Player;
