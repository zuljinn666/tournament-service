'use strict';

const co = require('co');
const mongoose = require('mongoose');

const HttpError = require('./HttpError');
const config = require('../config');

mongoose.Promise = global.Promise;

mongoose.connect(
  `mongodb://${config.db.host || 'localhost'}:${config.db.port || 27017}/${config.db.name}`,
  {useMongoClient: true}
);

class DB {
  constructor(className, classSchema) {
    Object.assign(this, {className, classSchema});

    if (mongoose.models[this.className]) {
      this.Schema = mongoose.models[this.className].schema;
      this.classSchema = this.Schema.classSchema;

      this.Model = mongoose.models[this.className];
    } else {
      this.Schema = this.parseSchema(classSchema);
      this.Schema.schema = this.classSchema;

      this.Model = mongoose.model(this.className, this.Schema);
    }

  }

  static validateId(id) {
    return id && id.toString && id.toString().match(/^[0-9a-f]{24}$/) ? mongoose.Types.ObjectId(id) : undefined;
  }

  static init(className, classSchema) {
    return new this(className, classSchema);
  }

  static createId() {
    var newId = new mongoose.mongo.ObjectId();
    return newId;
  }

  parseSchema(schema, subschemaFlag) {
    let parsedSchema = {};

    for (let fieldName in schema) {
      parsedSchema[fieldName] = this.parseSchemaField(schema[fieldName]);
    }

    if (subschemaFlag) { return new mongoose.Schema(parsedSchema, {_id: false}); }
    return new mongoose.Schema(parsedSchema);
  }

  parseSchemaField(options) {
    let field = {};

    switch (options.type) {
      case 'number':
      case 'float':
        field.type = mongoose.Schema.Types.Number;
        break;

      case 'string':
        field.type = mongoose.Schema.Types.String;
        break;
      
      case 'boolean':
        field.type = mongoose.Schema.Types.Boolean;
        break;
      
      case 'date':
        field.type = mongoose.Schema.Types.Date;
        break;
      
      case 'id':
        field.type = mongoose.Schema.Types.ObjectId;
        break;

      case 'mixed':
      case 'object':
        field.type = mongoose.Schema.Types.Mixed;
        field._id = false;
        break;

      case 'subschema':
        field = this.parseSchema(options.schema, true);
        break;

      default:
        break;
    }

    field.unique = options.unique && !options.array;
    if (options.unique) { field.required = true; }

    if (options.array) { field = [field]; }

    return field;
  }

  save(data, newFlag) {
    return co(function *() {
      let model = new this.Model(data);
      model.isNew = !!newFlag;

      let err = model.validateSync();
      if (err) {
        let message = err.message;
        if (err.errors) {
          message = Object.keys(err.errors).map(k => err.errors[k].message);
          message = message.join(' \n');
        }
        throw new HttpError(400, message, err);
      }

      try {
        yield model.save();
      } catch (err) {
        if (err.code == 11000) {
          throw new HttpError(400, 'Already exists');
        }
        throw new HttpError(500, err.message);
      }

      return yield this.read({_id: model._id});
    }.bind(this));
  }

  create(data) {
    return this.save(data, true);
  }

  read(conditions) {
    if (DB.validateId(conditions)) { conditions = {_id: DB.validateId(conditions)}; }

    let find = this.Model.find(conditions);

    return co(function *() {
      if (typeof conditions != 'object') { throw new HttpError(404, 'Incorrect find conditions'); }

      return yield find.exec();
    }.bind(this));
  }

  update(data) {
    return this.save(data);
  }

  delete(conditions) {
    if (DB.validateId(conditions)) { conditions = {_id: DB.validateId(conditions)}; }

    return this.Model.remove(conditions);
  }

  static dropDB() {
    return new Promise((resolve, reject) => {
      mongoose.connection.db.dropDatabase(error => {
        if (err) { return reject(error); }
        return resolve();
      });
    });
  }
}

module.exports = DB;
