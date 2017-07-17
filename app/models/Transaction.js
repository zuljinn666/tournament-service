'use strict';

const co = require('co');

const HttpError = require('./HttpError');
const DB = require('./DB');

let preparationQuery = [];
let lockedStack = {};

class Transaction {
  static get schema() {
    return {
      created: {type: 'number', required: true},
      state: {type: 'string', required: true},
      operations: {
        type: 'subschema',
        array: true,
        schema: {
          document_id: {type: 'id', required: true},
          document_type: {type: 'string', required: true},
          action: {type: 'string', required: true}
        }
      }
    }
  }

  static putToPreparationQuery(transactionId) {
    preparationQuery.push(transactionId);
  }

  static *waitPreparationQuery(transactionId) {
    let reachedHead;

    for (let i = 0; i < 500; i++) {
      reachedHead = yield new Promise((resolve, reject) => {
        setTimeout(function() {
          if (preparationQuery.indexOf(transactionId) == 0) { resolve(true); }
          reject(false);
        }, 1);
      });

      if (reachedHead) { return true; }
    }

    return false;
  }

  static removeFromPreparationQuery(transactionId) {
    preparationQuery.pop();
  }

  static executePreparation(transaction) {
    transaction.operations.map(operation => {
      if (!operation.document_id) { return; }
      Transaction.lockDocument(operation.document_id.toString(), transaction._id.toString());
    });
  }

  static executeHandler(transaction, handlerName) {
    let handler;
    switch (handlerName) {
      case 'lock':
        handler = Transaction.lockDocument;
        break;

      case 'unlock':
        handler = Transaction.unlockDocument;
        break;

      case 'check':
        handler = Transaction.checkLocks;
        break;

      default:
        handler = undefined;
        break;
    }

    if (!handler) { return; }

    let states = [];
    transaction.operations.map(operation => {
      if (!operation.document_id) { return; }
      let result = handler(operation.document_id.toString(), transaction._id.toString());
      states.push(result);
    });

    return states;
  }

  static lockDocument(documentId, transactionId) {
    let documentLocks = lockedStack[documentId];

    if (!documentLocks) { documentLocks = []; }

    documentLocks.push(transactionId);

    lockedStack[documentId] = documentLocks;
  }

  static unlockDocument(documentId, transactionId) {
    let documentLocks = lockedStack[documentId];
    let index = documentLocks.indexOf(transactionId);

    if (index < 0) { return; }

    documentLocks[index] = null;
    documentLocks = documentLocks.filter(item => item);

    lockedStack[documentId] = documentLocks;
  }

  static checkLocks(documentId, transactionId) {
    let documentLocks = lockedStack[documentId];
    let index = documentLocks.indexOf(transactionId);

    return index == 0 ? 'unlocked' : 'locked';
  }

  static *waitUnlockDocuments(transaction) {
    let unlocked;

    for (let i = 0; i < 100; i++) {
      unlocked = yield new Promise((resolve, reject) => {
        setTimeout(function() {
          let state;
          let states = Transaction.executeHandler(transaction, 'check');
          while (state = states.pop()) {
            if (state == 'locked') { reject(false); }
          }

          resolve(true);
        }, 2);
      });

      if (unlocked) { return true; }
    }

    return false;
  }
/*
*/
  static errorHandler(transaction, error) {
    Transaction.executeHandler(transaction, 'unlock');
    throw error;
  }

  static validateTransaction(transaction) {
    let err;
    if (typeof transaction != 'object') { err = true; }
    if (!transaction.created || !transaction.state) { err = true; }
    if (!transaction.operations || !transaction.operations.length) { err = true; }

    if (err) { throw new HttpError(400, 'Transaction Validation Failed'); }

    return transaction;
  }

  static transactionWorker() {
    return co(function *() {
      console.log('Transaction Worker Started', (new Date()).toUTCString());
      let transactionTable = DB.init('Transaction', Transaction.schema);
      
      let expire = parseInt(((Date.now()) - (60 * 1000)));
      let docs = yield transactionTable.read({created: {$lte: expire}});

      if (docs && docs.length) {
        function *rollbackTransactions(docs) {
          for (let i = 0; i < docs.length; i++) {
            if (docs[i].state == 'applied') { continue; }
            if (docs[i].state == 'init') { docs[i].state = 'rollbacked'; }
            if (['freeze', 'exec', 'rollback'].indexOf(docs[i].state) >= 0) { docs[i].state = 'pending_rollback'; }

            let result = yield transactionTable.update(docs[i]);
            if (!result || !result.length) { continue; }
            docs[i] = result[0];

            try {
              yield (new Transaction()).executeTransaction(docs[i]._id);
            } catch (error) {
              continue;
            }
          }
        }

        yield rollbackTransactions(docs);
      }
    }.bind(this));
  }

  createTransaction(transaction) {
    return co(function *() {
      transaction = Transaction.validateTransaction(transaction);

      let transactionTable = DB.init('Transaction', Transaction.schema);

      let result = yield transactionTable.create(transaction);

      if (!result || !result.length) { throw new HttpError(404, 'No Data Saved'); }
      result = result[0];

      return result._id.toString();
    }.bind(this));
  }

  executeTransaction(transactionId) {
    return co(function *() {
      let errorObject;
      let transactionTable = DB.init('Transaction', Transaction.schema);

      let docs = yield transactionTable.read({_id: transactionId});

      if (!docs || !docs.length) { throw new HttpError(404, 'Transaction Not Found'); }
      let transaction = docs[0];

      if (!transaction.operations || !transaction.operations.length) { return; }

      Transaction.putToPreparationQuery(transaction._id.toString());

      let start = Transaction.waitPreparationQuery(transaction._id.toString())
      if (!start) {
        throw new HttpError(404, 'Transaction Query Fullfilled');
      }

      Transaction.executeHandler(transaction, 'lock');

      Transaction.removeFromPreparationQuery(transaction._id.toString());

      start = yield Transaction.waitUnlockDocuments(transaction);
      if (!start) {
        throw new HttpError(404, 'Documents Locked By Another Transaction');
      }

      const classList = {
       Tournament: require('./Tournament'),
       Player: require('./Player')
      }

      function getClass(className) {
        return classList[className];
      }

      function setTransactionDetails(doc, transactionDetails) {
        if (!doc || !transactionDetails) { throw new HttpError(404, 'Can\'t Set Transaction Details'); }

        let exists = false;

        if (!doc.transactions) { doc.transactions = [] }

        doc.transactions.map(transactionRecord => {
          if (transactionRecord.transaction_id &&
              transactionRecord.transaction_id.toString() == transactionDetails.transaction_id.toString()) {
            exists = true;
          }
        });

        if (!exists) { doc.transactions.push(transactionDetails); }

        return doc;
      }

      function cleanDetails(doc, transactionId) {
        if (!doc) { throw new HttpError(404, 'Document Required'); }
        if (!transactionId) { throw new HttpError(404, 'Transaction Id Required'); }

        if (!doc.transactions || !Array.isArray(doc.transactions)) { return; }
        if (!doc.frozen || !Array.isArray(doc.frozen)) { return; }

        doc.transactions = doc.transactions.filter(transactionRecord => {
          if (transactionRecord.transaction_id &&
              transactionRecord.transaction_id.toString() == transactionId.toString()) { return false; }
          return transactionRecord;
        });

        doc.frozen = doc.frozen.filter(freezeRecord => {
          if (freezeRecord.transaction_id &&
              freezeRecord.transaction_id.toString() == transactionId.toString()) { return false; }
          return freezeRecord;
        });

        return doc;
      }

      function *executeTransactionStep(transaction, handler) {
        let operations = transaction.operations;

        for (let i = 0; i < operations.length; i++) {
          yield handler(transaction._id, operations[i]);
        }
      }

      function *cleanHandler(transactionId, operation) {
        let documentClass = getClass(operation.document_type);

        let doc = yield documentClass.find(operation.document_id);

        if (!doc) { return; }

        doc = cleanDetails(doc, transactionId);

        yield (new documentClass).update(doc);
      }

      /**
       * Init
       */
      if (transaction.state == 'init') {
        function *initHandler(transactionId, operation) {

          let documentClass = getClass(operation.document_type);

          let doc = yield documentClass.find(operation.document_id);

          if (!doc) { new HttpError(404, 'Document Not Found'); }

          let operationAction;
          let transactionDetails = {transaction_id: transactionId, state: 'pending'};
          let operationDetails = operation.action.split('|');
          let operationPoints;
          let operationContent;
          switch(operation.document_type) {
            case 'Player':
              operationPoints = operationDetails[1];
              operationAction = operationDetails[0];

              transactionDetails = Object.assign(transactionDetails, {
                action: operationAction,
                points: operationPoints
              });
              break;
              
            case 'Tournament':
              operationContent = operationDetails[1] ? JSON.parse(operationDetails[1]) : null;
              operationAction = operationDetails[0];

              transactionDetails = Object.assign(transactionDetails, {
                action: operationAction,
                content: operationContent
              });
              break;
          }

          doc = setTransactionDetails(doc, transactionDetails);

          yield (new documentClass).update(doc);
        }

        let result;
        try {
          yield executeTransactionStep(transaction, initHandler);

          transaction.state = 'freeze';
          result = yield transactionTable.update(transaction);

          if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
          transaction = result[0];
        } catch (error) {
          /**
           * Set transaction status rollbacked
           */
          try {
            transaction.state = 'rollbacked';
            result = yield transactionTable.update(transaction);

            if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
            transaction = result[0];

            errorObject = error;
          } catch (error) {
            errorHandler(transaction, error);
          }
        }
      }

      /**
       * Freeze
       */
      if (transaction.state == 'freeze') {
        function *freezeHandler(transactionId, operation) {
          let documentClass = getClass(operation.document_type);

          yield (new documentClass).freeze(operation.document_id, transactionId);
        }

        let result;
        try {
          /**
           * Freeze transaction details in docs
           */
          yield executeTransactionStep(transaction, freezeHandler);

          transaction.state = 'exec';
          result = yield transactionTable.update(transaction);

          if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
          transaction = result[0];
        } catch (error) {
          /**
           * Set rollback to transaction
           */
          try {
            transaction.state = 'rollback';
            result = yield transactionTable.update(transaction);

            if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
            transaction = result[0];

            errorObject = error;
          } catch (error) {
            errorHandler(transaction, error);
          }
        }
      }

      /**
       * Exec
       */
      if (transaction.state == 'exec') {
        function *execHandler(transactionId, operation) {
          let documentClass = getClass(operation.document_type);

          yield (new documentClass).apply(operation.document_id, transactionId);
        }

        let result;
        try {
          /**
           * Apply transaction details to docs
           */
          yield executeTransactionStep(transaction, execHandler);

          transaction.state = 'applied';

          result = yield transactionTable.update(transaction);

          if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
          transaction = result[0];
        } catch (error) {
          /**
           * Set rollback status to transaction
           */
          try {
            transaction.state = 'rollback';
            result = yield transactionTable.update(transaction);

            if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
            transaction = result[0];

            errorObject = error;
          } catch (error) {
            Transaction.errorHandler(transaction, error);
          }
        }
      }

      /**
        * Rollback
        */
      if (transaction.state == 'rollback' || transaction.state == 'pending_rollback') {
        function *rollbackHandler(transactionId, operation) {
          let documentClass = getClass(operation.document_type);

          yield (new documentClass).rollback(operation.document_id, transactionId);
        }

        let result;
        try {
          /**
           * Rollback transaction details in docs
           */
          yield executeTransactionStep(transaction, rollbackHandler);

          transaction.state = 'rollbacked';
          result = yield transactionTable.update(transaction);

          if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
          transaction = result[0];
        } catch (error) {
          /**
           * Set transaction pending rollback
           */
          transaction.state = 'pending_rollback';
          result = yield transactionTable.update(transaction);

          if (!result || !result.length) { throw new HttpError(404, 'Transaction State Not Updated'); }
          transaction = result[0];
          Transaction.errorHandler(transaction, error);
        }
      }

      /**
       * Clean
       */
      if (transaction.state == 'applied' || transaction.state == 'rollbacked') {
        try {
          yield executeTransactionStep(transaction, cleanHandler);

          if (transaction.state == 'applied') { Transaction.executeHandler(transaction, 'unlock'); }
          
          if (transaction.state == 'rollbacked') {
            yield transactionTable.delete(transaction._id);
            throw errorObject ? errorObject : new HttpError(404, 'Transaction Rejected');
          }
        } catch (error) {
          Transaction.errorHandler(transaction, error);
        }
      }

      return;
    }.bind(this));
  }
}

module.exports = Transaction;
