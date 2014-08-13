(function() {
    var Random = Package.random.Random;
    var EJSON = Package.ejson.EJSON;
    var LocalCollection = Package.minimongo.LocalCollection;
    Package.minimongo.Minimongo;
    Package.logging.Log;
    var DDP = Package.livedata.DDP;
    Package.deps.Deps;
    var check = Package.check.check;
    var Match = Package.check.Match;
    var LocalCollectionDriver;
    (function() {
        LocalCollectionDriver = function() {
            var self = this;
            self.noConnCollections = {};
        };
        var ensureCollection = function(name, collections) {
            name in collections || (collections[name] = new LocalCollection(name));
            return collections[name];
        };
        _.extend(LocalCollectionDriver.prototype, {
            open: function(name, conn) {
                var self = this;
                if (!name) return new LocalCollection();
                if (!conn) return ensureCollection(name, self.noConnCollections);
                conn._mongo_livedata_collections || (conn._mongo_livedata_collections = {});
                return ensureCollection(name, conn._mongo_livedata_collections);
            }
        });
        LocalCollectionDriver = new LocalCollectionDriver();
    }).call(this);
    (function() {
        Meteor.Collection = function(name, options) {
            var self = this;
            if (!(self instanceof Meteor.Collection)) throw new Error('use "new" to construct a Meteor.Collection');
            if (!name && null !== name) {
                Meteor._debug("Warning: creating anonymous collection. It will not be saved or synchronized over the network. (Pass null for the collection name to turn off this warning.)");
                name = null;
            }
            if (null !== name && "string" != typeof name) throw new Error("First argument to new Meteor.Collection must be a string or null");
            options && options.methods && (options = {
                connection: options
            });
            options && options.manager && !options.connection && (options.connection = options.manager);
            options = _.extend({
                connection: void 0,
                idGeneration: "STRING",
                transform: null,
                _driver: void 0,
                _preventAutopublish: false
            }, options);
            switch (options.idGeneration) {
              case "MONGO":
                self._makeNewID = function() {
                    var src = name ? DDP.randomStream("/collection/" + name) : Random;
                    return new Meteor.Collection.ObjectID(src.hexString(24));
                };
                break;

              case "STRING":
              default:
                self._makeNewID = function() {
                    var src = name ? DDP.randomStream("/collection/" + name) : Random;
                    return src.id();
                };
            }
            self._transform = LocalCollection.wrapTransform(options.transform);
            self._connection = name && null !== options.connection ? options.connection ? options.connection : Meteor.isClient ? Meteor.connection : Meteor.server : null;
            options._driver || (options._driver = name && self._connection === Meteor.server && "undefined" != typeof MongoInternals && MongoInternals.defaultRemoteCollectionDriver ? MongoInternals.defaultRemoteCollectionDriver() : LocalCollectionDriver);
            self._collection = options._driver.open(name, self._connection);
            self._name = name;
            if (self._connection && self._connection.registerStore) {
                var ok = self._connection.registerStore(name, {
                    beginUpdate: function(batchSize, reset) {
                        (batchSize > 1 || reset) && self._collection.pauseObservers();
                        reset && self._collection.remove({});
                    },
                    update: function(msg) {
                        var mongoId = LocalCollection._idParse(msg.id);
                        var doc = self._collection.findOne(mongoId);
                        if ("replace" === msg.msg) {
                            var replace = msg.replace;
                            replace ? doc ? self._collection.update(mongoId, replace) : self._collection.insert(replace) : doc && self._collection.remove(mongoId);
                            return;
                        }
                        if ("added" === msg.msg) {
                            if (doc) throw new Error("Expected not to find a document already present for an add");
                            self._collection.insert(_.extend({
                                _id: mongoId
                            }, msg.fields));
                        } else if ("removed" === msg.msg) {
                            if (!doc) throw new Error("Expected to find a document already present for removed");
                            self._collection.remove(mongoId);
                        } else {
                            if ("changed" !== msg.msg) throw new Error("I don't know how to deal with this message");
                            if (!doc) throw new Error("Expected to find a document to change");
                            if (!_.isEmpty(msg.fields)) {
                                var modifier = {};
                                _.each(msg.fields, function(value, key) {
                                    if (void 0 === value) {
                                        modifier.$unset || (modifier.$unset = {});
                                        modifier.$unset[key] = 1;
                                    } else {
                                        modifier.$set || (modifier.$set = {});
                                        modifier.$set[key] = value;
                                    }
                                });
                                self._collection.update(mongoId, modifier);
                            }
                        }
                    },
                    endUpdate: function() {
                        self._collection.resumeObservers();
                    },
                    saveOriginals: function() {
                        self._collection.saveOriginals();
                    },
                    retrieveOriginals: function() {
                        return self._collection.retrieveOriginals();
                    }
                });
                if (!ok) throw new Error("There is already a collection named '" + name + "'");
            }
            self._defineMutationMethods();
            Package.autopublish && !options._preventAutopublish && self._connection && self._connection.publish && self._connection.publish(null, function() {
                return self.find();
            }, {
                is_auto: true
            });
        };
        _.extend(Meteor.Collection.prototype, {
            _getFindSelector: function(args) {
                return 0 == args.length ? {} : args[0];
            },
            _getFindOptions: function(args) {
                var self = this;
                if (2 > args.length) return {
                    transform: self._transform
                };
                check(args[1], Match.Optional(Match.ObjectIncluding({
                    fields: Match.Optional(Match.OneOf(Object, void 0)),
                    sort: Match.Optional(Match.OneOf(Object, Array, void 0)),
                    limit: Match.Optional(Match.OneOf(Number, void 0)),
                    skip: Match.Optional(Match.OneOf(Number, void 0))
                })));
                return _.extend({
                    transform: self._transform
                }, args[1]);
            },
            find: function() {
                var self = this;
                var argArray = _.toArray(arguments);
                return self._collection.find(self._getFindSelector(argArray), self._getFindOptions(argArray));
            },
            findOne: function() {
                var self = this;
                var argArray = _.toArray(arguments);
                return self._collection.findOne(self._getFindSelector(argArray), self._getFindOptions(argArray));
            }
        });
        Meteor.Collection._publishCursor = function(cursor, sub, collection) {
            var observeHandle = cursor.observeChanges({
                added: function(id, fields) {
                    sub.added(collection, id, fields);
                },
                changed: function(id, fields) {
                    sub.changed(collection, id, fields);
                },
                removed: function(id) {
                    sub.removed(collection, id);
                }
            });
            sub.onStop(function() {
                observeHandle.stop();
            });
        };
        Meteor.Collection._rewriteSelector = function(selector) {
            LocalCollection._selectorIsId(selector) && (selector = {
                _id: selector
            });
            if (!selector || "_id" in selector && !selector._id) return {
                _id: Random.id()
            };
            var ret = {};
            _.each(selector, function(value, key) {
                if (value instanceof RegExp) ret[key] = convertRegexpToMongoSelector(value); else if (value && value.$regex instanceof RegExp) {
                    ret[key] = convertRegexpToMongoSelector(value.$regex);
                    void 0 !== value.$options && (ret[key].$options = value.$options);
                } else ret[key] = _.contains([ "$or", "$and", "$nor" ], key) ? _.map(value, function(v) {
                    return Meteor.Collection._rewriteSelector(v);
                }) : value;
            });
            return ret;
        };
        var convertRegexpToMongoSelector = function(regexp) {
            check(regexp, RegExp);
            var selector = {
                $regex: regexp.source
            };
            var regexOptions = "";
            regexp.ignoreCase && (regexOptions += "i");
            regexp.multiline && (regexOptions += "m");
            regexOptions && (selector.$options = regexOptions);
            return selector;
        };
        var throwIfSelectorIsNotId = function(selector, methodName) {
            if (!LocalCollection._selectorIsIdPerhapsAsObject(selector)) throw new Meteor.Error(403, "Not permitted. Untrusted code may only " + methodName + " documents by ID.");
        };
        _.each([ "insert", "update", "remove" ], function(name) {
            Meteor.Collection.prototype[name] = function() {
                var self = this;
                var args = _.toArray(arguments);
                var callback;
                var insertId;
                var ret;
                args.length && args[args.length - 1] instanceof Function && (callback = args.pop());
                if ("insert" === name) {
                    if (!args.length) throw new Error("insert requires an argument");
                    args[0] = _.extend({}, args[0]);
                    if ("_id" in args[0]) {
                        insertId = args[0]._id;
                        if (!insertId || !("string" == typeof insertId || insertId instanceof Meteor.Collection.ObjectID)) throw new Error("Meteor requires document _id fields to be non-empty strings or ObjectIDs");
                    } else {
                        var generateId = true;
                        if (self._connection && self._connection !== Meteor.server) {
                            var enclosing = DDP._CurrentInvocation.get();
                            enclosing || (generateId = false);
                        }
                        generateId && (insertId = args[0]._id = self._makeNewID());
                    }
                } else {
                    args[0] = Meteor.Collection._rewriteSelector(args[0]);
                    if ("update" === name) {
                        var options = args[2] = _.clone(args[2]) || {};
                        if (options && "function" != typeof options && options.upsert) if (options.insertedId) {
                            if (!("string" == typeof options.insertedId || options.insertedId instanceof Meteor.Collection.ObjectID)) throw new Error("insertedId must be string or ObjectID");
                        } else options.insertedId = self._makeNewID();
                    }
                }
                var chooseReturnValueFromCollectionResult = function(result) {
                    if ("insert" === name) {
                        !insertId && result && (insertId = result);
                        return insertId;
                    }
                    return result;
                };
                var wrappedCallback;
                callback && (wrappedCallback = function(error, result) {
                    callback(error, !error && chooseReturnValueFromCollectionResult(result));
                });
                if (self._connection && self._connection !== Meteor.server) {
                    var enclosing = DDP._CurrentInvocation.get();
                    var alreadyInSimulation = enclosing && enclosing.isSimulation;
                    !Meteor.isClient || wrappedCallback || alreadyInSimulation || (wrappedCallback = function(err) {
                        err && Meteor._debug(name + " failed: " + (err.reason || err.stack));
                    });
                    alreadyInSimulation || "insert" === name || throwIfSelectorIsNotId(args[0], name);
                    ret = chooseReturnValueFromCollectionResult(self._connection.apply(self._prefix + name, args, {
                        returnStubValue: true
                    }, wrappedCallback));
                } else {
                    args.push(wrappedCallback);
                    try {
                        var queryRet = self._collection[name].apply(self._collection, args);
                        ret = chooseReturnValueFromCollectionResult(queryRet);
                    } catch (e) {
                        if (callback) {
                            callback(e);
                            return null;
                        }
                        throw e;
                    }
                }
                return ret;
            };
        });
        Meteor.Collection.prototype.upsert = function(selector, modifier, options, callback) {
            var self = this;
            if (!callback && "function" == typeof options) {
                callback = options;
                options = {};
            }
            return self.update(selector, modifier, _.extend({}, options, {
                _returnObject: true,
                upsert: true
            }), callback);
        };
        Meteor.Collection.prototype._ensureIndex = function(index, options) {
            var self = this;
            if (!self._collection._ensureIndex) throw new Error("Can only call _ensureIndex on server collections");
            self._collection._ensureIndex(index, options);
        };
        Meteor.Collection.prototype._dropIndex = function(index) {
            var self = this;
            if (!self._collection._dropIndex) throw new Error("Can only call _dropIndex on server collections");
            self._collection._dropIndex(index);
        };
        Meteor.Collection.prototype._dropCollection = function() {
            var self = this;
            if (!self._collection.dropCollection) throw new Error("Can only call _dropCollection on server collections");
            self._collection.dropCollection();
        };
        Meteor.Collection.prototype._createCappedCollection = function(byteSize) {
            var self = this;
            if (!self._collection._createCappedCollection) throw new Error("Can only call _createCappedCollection on server collections");
            self._collection._createCappedCollection(byteSize);
        };
        Meteor.Collection.ObjectID = LocalCollection._ObjectID;
        (function() {
            var addValidator = function(allowOrDeny, options) {
                var VALID_KEYS = [ "insert", "update", "remove", "fetch", "transform" ];
                _.each(_.keys(options), function(key) {
                    if (!_.contains(VALID_KEYS, key)) throw new Error(allowOrDeny + ": Invalid key: " + key);
                });
                var self = this;
                self._restricted = true;
                _.each([ "insert", "update", "remove" ], function(name) {
                    if (options[name]) {
                        if (!(options[name] instanceof Function)) throw new Error(allowOrDeny + ": Value for `" + name + "` must be a function");
                        options[name].transform = void 0 === options.transform ? self._transform : LocalCollection.wrapTransform(options.transform);
                        self._validators[name][allowOrDeny].push(options[name]);
                    }
                });
                if (options.update || options.remove || options.fetch) {
                    if (options.fetch && !(options.fetch instanceof Array)) throw new Error(allowOrDeny + ": Value for `fetch` must be an array");
                    self._updateFetch(options.fetch);
                }
            };
            Meteor.Collection.prototype.allow = function(options) {
                addValidator.call(this, "allow", options);
            };
            Meteor.Collection.prototype.deny = function(options) {
                addValidator.call(this, "deny", options);
            };
        })();
        Meteor.Collection.prototype._defineMutationMethods = function() {
            var self = this;
            self._restricted = false;
            self._insecure = void 0;
            self._validators = {
                insert: {
                    allow: [],
                    deny: []
                },
                update: {
                    allow: [],
                    deny: []
                },
                remove: {
                    allow: [],
                    deny: []
                },
                upsert: {
                    allow: [],
                    deny: []
                },
                fetch: [],
                fetchAllFields: false
            };
            if (!self._name) return;
            self._prefix = "/" + self._name + "/";
            if (self._connection) {
                var m = {};
                _.each([ "insert", "update", "remove" ], function(method) {
                    m[self._prefix + method] = function() {
                        check(arguments, [ Match.Any ]);
                        var args = _.toArray(arguments);
                        try {
                            var generatedId = null;
                            "insert" !== method || _.has(args[0], "_id") || (generatedId = self._makeNewID());
                            if (this.isSimulation) {
                                null !== generatedId && (args[0]._id = generatedId);
                                return self._collection[method].apply(self._collection, args);
                            }
                            "insert" !== method && throwIfSelectorIsNotId(args[0], method);
                            if (self._restricted) {
                                if (0 === self._validators[method].allow.length) throw new Meteor.Error(403, "Access denied. No allow validators set on restricted collection for method '" + method + "'.");
                                var validatedMethodName = "_validated" + method.charAt(0).toUpperCase() + method.slice(1);
                                args.unshift(this.userId);
                                "insert" === method && args.push(generatedId);
                                return self[validatedMethodName].apply(self, args);
                            }
                            if (self._isInsecure()) {
                                null !== generatedId && (args[0]._id = generatedId);
                                return self._collection[method].apply(self._collection, args);
                            }
                            throw new Meteor.Error(403, "Access denied");
                        } catch (e) {
                            throw "MongoError" === e.name || "MinimongoError" === e.name ? new Meteor.Error(409, e.toString()) : e;
                        }
                    };
                });
                (Meteor.isClient || self._connection === Meteor.server) && self._connection.methods(m);
            }
        };
        Meteor.Collection.prototype._updateFetch = function(fields) {
            var self = this;
            if (!self._validators.fetchAllFields) if (fields) self._validators.fetch = _.union(self._validators.fetch, fields); else {
                self._validators.fetchAllFields = true;
                self._validators.fetch = null;
            }
        };
        Meteor.Collection.prototype._isInsecure = function() {
            var self = this;
            if (void 0 === self._insecure) return !!Package.insecure;
            return self._insecure;
        };
        var docToValidate = function(validator, doc, generatedId) {
            var ret = doc;
            if (validator.transform) {
                ret = EJSON.clone(doc);
                null !== generatedId && (ret._id = generatedId);
                ret = validator.transform(ret);
            }
            return ret;
        };
        Meteor.Collection.prototype._validatedInsert = function(userId, doc, generatedId) {
            var self = this;
            if (_.any(self._validators.insert.deny, function(validator) {
                return validator(userId, docToValidate(validator, doc, generatedId));
            })) throw new Meteor.Error(403, "Access denied");
            if (_.all(self._validators.insert.allow, function(validator) {
                return !validator(userId, docToValidate(validator, doc, generatedId));
            })) throw new Meteor.Error(403, "Access denied");
            null !== generatedId && (doc._id = generatedId);
            self._collection.insert.call(self._collection, doc);
        };
        var transformDoc = function(validator, doc) {
            if (validator.transform) return validator.transform(doc);
            return doc;
        };
        Meteor.Collection.prototype._validatedUpdate = function(userId, selector, mutator, options) {
            var self = this;
            options = options || {};
            if (!LocalCollection._selectorIsIdPerhapsAsObject(selector)) throw new Error("validated update should be of a single ID");
            if (options.upsert) throw new Meteor.Error(403, "Access denied. Upserts not allowed in a restricted collection.");
            var fields = [];
            _.each(mutator, function(params, op) {
                if ("$" !== op.charAt(0)) throw new Meteor.Error(403, "Access denied. In a restricted collection you can only update documents, not replace them. Use a Mongo update operator, such as '$set'.");
                if (!_.has(ALLOWED_UPDATE_OPERATIONS, op)) throw new Meteor.Error(403, "Access denied. Operator " + op + " not allowed in a restricted collection.");
                _.each(_.keys(params), function(field) {
                    -1 !== field.indexOf(".") && (field = field.substring(0, field.indexOf(".")));
                    _.contains(fields, field) || fields.push(field);
                });
            });
            var findOptions = {
                transform: null
            };
            if (!self._validators.fetchAllFields) {
                findOptions.fields = {};
                _.each(self._validators.fetch, function(fieldName) {
                    findOptions.fields[fieldName] = 1;
                });
            }
            var doc = self._collection.findOne(selector, findOptions);
            if (!doc) return 0;
            var factoriedDoc;
            if (_.any(self._validators.update.deny, function(validator) {
                factoriedDoc || (factoriedDoc = transformDoc(validator, doc));
                return validator(userId, factoriedDoc, fields, mutator);
            })) throw new Meteor.Error(403, "Access denied");
            if (_.all(self._validators.update.allow, function(validator) {
                factoriedDoc || (factoriedDoc = transformDoc(validator, doc));
                return !validator(userId, factoriedDoc, fields, mutator);
            })) throw new Meteor.Error(403, "Access denied");
            return self._collection.update.call(self._collection, selector, mutator, options);
        };
        var ALLOWED_UPDATE_OPERATIONS = {
            $inc: 1,
            $set: 1,
            $unset: 1,
            $addToSet: 1,
            $pop: 1,
            $pullAll: 1,
            $pull: 1,
            $pushAll: 1,
            $push: 1,
            $bit: 1
        };
        Meteor.Collection.prototype._validatedRemove = function(userId, selector) {
            var self = this;
            var findOptions = {
                transform: null
            };
            if (!self._validators.fetchAllFields) {
                findOptions.fields = {};
                _.each(self._validators.fetch, function(fieldName) {
                    findOptions.fields[fieldName] = 1;
                });
            }
            var doc = self._collection.findOne(selector, findOptions);
            if (!doc) return 0;
            if (_.any(self._validators.remove.deny, function(validator) {
                return validator(userId, transformDoc(validator, doc));
            })) throw new Meteor.Error(403, "Access denied");
            if (_.all(self._validators.remove.allow, function(validator) {
                return !validator(userId, transformDoc(validator, doc));
            })) throw new Meteor.Error(403, "Access denied");
            return self._collection.remove.call(self._collection, selector);
        };
    }).call(this);
    "undefined" == typeof Package && (Package = {});
    Package["mongo-livedata"] = {};
})();