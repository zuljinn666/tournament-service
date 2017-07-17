'use strict';

const co = require('co');

const HttpError = require('./HttpError');
const DB = require('./DB');
const Player = require('./Player');
const Transaction = require('./Transaction');

class Tournament {
  static get schema() {
    return {
      tournament_id: {type: 'number', unique: true},
      status: {type: 'string'},
      deposit: {type: 'number'},
      participants: {
        type: 'subschema',
        array: true,
        schema: {
          participant_id: {type: 'id'},
          representative: {type: 'string'},
          backers: {type: 'string', array: true}
        }
      },
      frozen: {
        type: 'subschema',
        array: true,
        schema: {
          transaction_id: {type: 'id'},
          applied: {type: 'boolean'},
          action: {type: 'string'},
          content: {type: 'mixed'}
        }
      },
      transactions: {
        type: 'subschema',
        array: true,
        schema: {
          transaction_id: {type: 'id'},
          state: {type: 'string'},
          action: {type: 'string'},
          content: {type: 'mixed'}
        }
      }
    }
  }

  static find(tournamentId) {
    return co(function *() {
      if (!tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs = yield tournamentTable.read({_id: tournamentId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }

      return docs[0];
    }.bind(this));
  }

  static findTournament(tournamentId) {
    return co(function *() {
      if (!tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs = yield tournamentTable.read({tournament_id: tournamentId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }

      return docs[0];
    }.bind(this));
  }

  update(tournament) {
    return co(function *() {
      if (!tournament._id) { throw new HttpError(404, 'Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let result = yield tournamentTable.update(tournament);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  getDocumentTransaction(tournament, transactionId, stateName) {
    let documentTransaction = {};

    tournament.transactions = tournament.transactions.map(transactionRecord => {
      if (transactionRecord.transaction_id.toString() == transactionId) {
        documentTransaction.completed = transactionRecord.state == stateName ? true : false;
        transactionRecord.state = stateName;
        documentTransaction.transactionDetails = transactionRecord;
      }

      return transactionRecord;
    });

    documentTransaction.tournament = tournament;

    return documentTransaction;
  }

  freeze(tournamentId, transactionId) {
    return co(function *() {
      if (!tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs = yield tournamentTable.read({_id: tournamentId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }
      let tournament = docs[0];

      if (!tournament.transactions || !Array.isArray(tournament.transactions)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }
      if (!tournament.frozen || !Array.isArray(tournament.frozen)) { tournament.frozen = []; }

      let documentTransaction = this.getDocumentTransaction(tournament, transactionId, 'frozen');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      tournament = documentTransaction.tournament;

      if (!transactionDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }
      if (completed) { return; }

      let action = transactionDetails.action;
      switch (action) {
        case 'join':
          tournament.frozen.push({
            transaction_id: transactionDetails.transaction_id,
            action: 'join',
            content: transactionDetails.content,
            applied: false
          });
          break;

        case 'close':
          tournament.frozen.push({
            transaction_id: transactionDetails.transaction_id,
            action: 'close',
            content: transactionDetails.content,
            applied: false
          });
          break;

        default:
          break;
      }
      
      let result = yield tournamentTable.update(tournament);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  apply(tournamentId, transactionId) {
    return co(function *() {
      if (!tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs = yield tournamentTable.read({_id: tournamentId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }
      let tournament = docs[0];

      if (!tournament.transactions || !Array.isArray(tournament.transactions) ||
          !tournament.frozen || !Array.isArray(tournament.frozen)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }

      let documentTransaction = this.getDocumentTransaction(tournament, transactionId, 'applied');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      tournament = documentTransaction.tournament;

      if (!transactionDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }
      if (completed) { return; }

      let index;
      let freezeDetails;
      tournament.frozen.map((freezeRecord, i) => {
        if (freezeRecord.transaction_id.toString() == transactionId) {
          freezeDetails = freezeRecord;
          index = i;
        }
      });

      if (!freezeDetails) { throw new HttpError(404, 'Transaction Details Not Found'); }

      let action = freezeDetails.action;
      switch (action) {
        case 'join':
          tournament.participants.map(participant => {
            if (participant.participant_id == freezeDetails.content.participant_id) {
              throw new HttpError(404, `Player ${freezeDetails.participant.representative} Already Joined`);
            }
          });
          tournament.participants.push(freezeDetails.content);
          break;

        case 'close':
          tournament.status = 'closed';
          break;

        default:
          break;
      }

      tournament.frozen[index].applied = true;

      let result = yield tournamentTable.update(tournament);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  rollback(tournamentId, transactionId) {
    return co(function *() {
      if (!tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs = yield tournamentTable.read({_id: tournamentId});

      if (!docs || !docs.length) { return; }
      let tournament = docs[0];

      if (!tournament.transactions || !Array.isArray(tournament.transactions) ||
          !tournament.frozen || !Array.isArray(tournament.frozen)) {
        throw new HttpError(404, 'Transaction Details Not Found');
      }

      let documentTransaction = this.getDocumentTransaction(tournament, transactionId, 'rollbacked');
      let completed = documentTransaction.completed;
      let transactionDetails = documentTransaction.transactionDetails;
      tournament = documentTransaction.tournament;

      if (completed) { return; }

      let index;
      let freezeDetails;
      tournament.frozen.map((freezeRecord, i) => {
        if (freezeRecord.transaction_id.toString() == transactionId) {
          freezeDetails = freezeRecord;
          index = i;
        }
      });

      if (!freezeDetails) { return; }

      if (freezeDetails.applied === true) {
        let action = freezeDetails.action;
        switch (action) {
          case 'join':
            tournament.participants = tournament.participants.filter(participant => {
              if (participant.participant_id == freezeDetails.content.participant_id) {
                return false;
              }

              return participant;
            });
            break;

          case 'close':
            tournament.status = 'open';
            break;

          default:
            break;
        }

        tournament.frozen[index].applied = false;
      }

      let result = yield tournamentTable.update(tournament);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));
  }

  announceTournament(tournament) {
    return co(function *() {
      if (!tournament.tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!tournament.deposit) { throw new HttpError(404, 'Tournament Deposit Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let result;
      result = yield tournamentTable.create({
        tournament_id: tournament.tournamentId,
        deposit: tournament.deposit,
        status: 'open'
      });

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }

      return;
    }.bind(this));

  }

  joinTournament(ticket) {
    return co(function *() {
      if (!ticket.tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!ticket.playerId) { throw new HttpError(404, 'Player Id Required'); }
 
      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs;

      docs = yield tournamentTable.read({tournament_id: ticket.tournamentId});
      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }
      let tournament = docs[0];

      if (tournament.status == 'closed') { throw new HttpError(404, 'Tournament Closed'); }

      let playerTable = DB.init('Player', Player.schema);

      docs = yield playerTable.read({player_id: ticket.playerId});
      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }
      let player = docs[0];
      
      function *getBacker(backer) {
        let result = yield playerTable.read({player_id: backer});  
        if (!result || !result.length) { throw new HttpError(404, 'Player Not Found'); }
        return result[0];
      }

      function *validateBackers(backers) {
        for (let i = 0; i < backers.length; i++) { backers[i] = yield getBacker(backers[i]); }
        return backers;
      }

      let backers = [];
      if (ticket.backerId) {
        if (!Array.isArray(ticket.backerId)) { ticket.backerId = [ticket.backerId] }

        backers = yield validateBackers(ticket.backerId);
      }

      let deposit = parseFloat(tournament.deposit);
      let deposit_part = (deposit / (1 + backers.length)).toFixed(2);

      let transaction_operations = [];

      function cantFund(id) { throw new HttpError(404, `Player \"${id}\" - Not Enough Points`); }
      backers.map(backer => {
        if (backer.balance < deposit_part) { cantFund(backer.player_id); }

        transaction_operations.push({
          document_id: backer._id,
          document_type: 'Player',
          action: 'take|' + deposit_part
        });
      });

      let player_deposit = (deposit - (deposit_part * backers.length)).toFixed(2);
      if (player.balance < player_deposit) { cantFund(player.player_id); }

      transaction_operations.push({
        document_id: player._id,
        document_type: 'Player',
        action: 'take|' + player_deposit
      });

      let newId = DB.createId();

      if (!newId) { throw new HttpError(404, 'Create Participant Failed'); }

      let participant = {
        participant_id: newId,
        representative: player.player_id,
        backers: backers.map(backer => backer.player_id)
      }

      tournament.participants.push(participant);
      transaction_operations.push({
        document_id: tournament._id,
        document_type: 'Tournament',
        action: 'join|' + JSON.stringify(participant)
      });

      let transaction = {
        created: Date.now(),
        state: 'init',
        operations: transaction_operations
      };

      let transact = new Transaction();

      let transactionId = yield transact.createTransaction(transaction);

      yield transact.executeTransaction(transactionId);

      return;
    }.bind(this));
  }

  resultTournament(tournamentResult) {
    return co(function *() {
      if (!tournamentResult.tournamentId) { throw new HttpError(404, 'Tournament Id Required'); }
      if (!tournamentResult.winners || !Array.isArray(tournamentResult.winners) || !tournamentResult.winners.length) {
        throw new HttpError(404, 'Winner Required');
      }
      let winner = tournamentResult.winners[0];

      if (!winner.playerId || !winner.prize) { throw new HttpError(404, 'Winner Id And Prize Required'); }

      let tournamentTable = DB.init('Tournament', Tournament.schema);

      let docs;

      docs = yield tournamentTable.read({tournament_id: tournamentResult.tournamentId});
      if (!docs || !docs.length) { throw new HttpError(404, 'Tournament Not Found'); }
      let tournament = docs[0];

      if (tournament.status == 'closed') { throw new HttpError(404, 'Tournament Closed'); }

      let playerTable = DB.init('Player', Player.schema);

      docs = yield playerTable.read({player_id: winner.playerId});
      if (!docs || !docs.length) { throw new HttpError(404, 'Player Not Found'); }
      let player = docs[0];

      let member;
      tournament.participants.map(participant => {
        if (player.player_id == participant.representative) { member = participant; }
      });

      if (!member) { throw new HttpError(404, 'Player Not Participate In Tournament'); }
      
      function *getBacker(backer) {
        let result = yield playerTable.read({player_id: backer});  
        if (!result || !result.length) { throw new HttpError(404, 'Player Not Found'); }
        return result[0];
      }

      function *validateBackers(backers) {
        for (let i = 0; i < backers.length; i++) { backers[i] = yield getBacker(backers[i]); }
        return backers;
      }

      let backers = yield validateBackers(member.backers);

      let prize = parseFloat(winner.prize);
      let prize_part = (prize / (1 + backers.length)).toFixed(2);

      let transaction_operations = [];

      backers.map(backer => {
        transaction_operations.push({
          document_id: backer._id,
          document_type: 'Player',
          action: 'fund|' + prize_part
        });
      });

      let player_prize = (prize - (prize_part * backers.length)).toFixed(2);

      transaction_operations.push({
        document_id: player._id,
        document_type: 'Player',
        action: 'fund|' + player_prize
      });

      transaction_operations.push({
        document_id: tournament._id,
        document_type: 'Tournament',
        action: 'close'
      });

      let transaction = {
        created: Date.now(),
        state: 'init',
        operations: transaction_operations
      };

      let transact = new Transaction();

      let transactionId = yield transact.createTransaction(transaction);

      yield transact.executeTransaction(transactionId);

      return;
    }.bind(this));
  }
};

module.exports = Tournament;