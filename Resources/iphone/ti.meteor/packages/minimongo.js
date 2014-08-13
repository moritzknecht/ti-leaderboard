(function() {
    var Meteor = Package.meteor.Meteor;
    var JSON = Package.json.JSON;
    var EJSON = Package.ejson.EJSON;
    var IdMap = Package["id-map"].IdMap;
    var OrderedDict = Package["ordered-dict"].OrderedDict;
    var Deps = Package.deps.Deps;
    var Random = Package.random.Random;
    var GeoJSON = Package["geojson-utils"].GeoJSON;
    var LocalCollection, Minimongo, MinimongoTest, MinimongoError, isArray, isPlainObject, isIndexable, isOperatorObject, isNumericKey, regexpElementMatcher, equalityElementMatcher, ELEMENT_OPERATORS, makeLookupFunction, expandArraysInBranches, projectionDetails, pathsToTree;
    (function() {
        LocalCollection = function(name) {
            var self = this;
            self.name = name;
            self._docs = new LocalCollection._IdMap();
            self._observeQueue = new Meteor._SynchronousQueue();
            self.next_qid = 1;
            self.queries = {};
            self._savedOriginals = null;
            self.paused = false;
        };
        Minimongo = {};
        MinimongoTest = {};
        LocalCollection._applyChanges = function(doc, changeFields) {
            _.each(changeFields, function(value, key) {
                void 0 === value ? delete doc[key] : doc[key] = value;
            });
        };
        MinimongoError = function(message) {
            var e = new Error(message);
            e.name = "MinimongoError";
            return e;
        };
        LocalCollection.prototype.find = function(selector, options) {
            0 === arguments.length && (selector = {});
            return new LocalCollection.Cursor(this, selector, options);
        };
        LocalCollection.Cursor = function(collection, selector, options) {
            var self = this;
            options || (options = {});
            self.collection = collection;
            self.sorter = null;
            if (LocalCollection._selectorIsId(selector)) {
                self._selectorId = selector;
                self.matcher = new Minimongo.Matcher(selector, self);
            } else {
                self._selectorId = void 0;
                self.matcher = new Minimongo.Matcher(selector, self);
                (self.matcher.hasGeoQuery() || options.sort) && (self.sorter = new Minimongo.Sorter(options.sort || [], {
                    matcher: self.matcher
                }));
            }
            self.skip = options.skip;
            self.limit = options.limit;
            self.fields = options.fields;
            self.fields && (self.projectionFn = LocalCollection._compileProjection(self.fields));
            self._transform = LocalCollection.wrapTransform(options.transform);
            "undefined" != typeof Deps && (self.reactive = void 0 === options.reactive ? true : options.reactive);
        };
        LocalCollection.Cursor.prototype.rewind = function() {};
        LocalCollection.prototype.findOne = function(selector, options) {
            0 === arguments.length && (selector = {});
            options = options || {};
            options.limit = 1;
            return this.find(selector, options).fetch()[0];
        };
        LocalCollection.Cursor.prototype.forEach = function(callback, thisArg) {
            var self = this;
            var objects = self._getRawObjects({
                ordered: true
            });
            self.reactive && self._depend({
                addedBefore: true,
                removed: true,
                changed: true,
                movedBefore: true
            });
            _.each(objects, function(elt, i) {
                elt = self.projectionFn ? self.projectionFn(elt) : EJSON.clone(elt);
                self._transform && (elt = self._transform(elt));
                callback.call(thisArg, elt, i, self);
            });
        };
        LocalCollection.Cursor.prototype.getTransform = function() {
            return this._transform;
        };
        LocalCollection.Cursor.prototype.map = function(callback, thisArg) {
            var self = this;
            var res = [];
            self.forEach(function(doc, index) {
                res.push(callback.call(thisArg, doc, index, self));
            });
            return res;
        };
        LocalCollection.Cursor.prototype.fetch = function() {
            var self = this;
            var res = [];
            self.forEach(function(doc) {
                res.push(doc);
            });
            return res;
        };
        LocalCollection.Cursor.prototype.count = function() {
            var self = this;
            self.reactive && self._depend({
                added: true,
                removed: true
            }, true);
            return self._getRawObjects({
                ordered: true
            }).length;
        };
        LocalCollection.Cursor.prototype._publishCursor = function(sub) {
            var self = this;
            if (!self.collection.name) throw new Error("Can't publish a cursor from a collection without a name.");
            var collection = self.collection.name;
            return Meteor.Collection._publishCursor(self, sub, collection);
        };
        LocalCollection.Cursor.prototype._getCollectionName = function() {
            var self = this;
            return self.collection.name;
        };
        LocalCollection._observeChangesCallbacksAreOrdered = function(callbacks) {
            if (callbacks.added && callbacks.addedBefore) throw new Error("Please specify only one of added() and addedBefore()");
            return !!(callbacks.addedBefore || callbacks.movedBefore);
        };
        LocalCollection._observeCallbacksAreOrdered = function(callbacks) {
            if (callbacks.addedAt && callbacks.added) throw new Error("Please specify only one of added() and addedAt()");
            if (callbacks.changedAt && callbacks.changed) throw new Error("Please specify only one of changed() and changedAt()");
            if (callbacks.removed && callbacks.removedAt) throw new Error("Please specify only one of removed() and removedAt()");
            return !!(callbacks.addedAt || callbacks.movedTo || callbacks.changedAt || callbacks.removedAt);
        };
        LocalCollection.ObserveHandle = function() {};
        _.extend(LocalCollection.Cursor.prototype, {
            observe: function(options) {
                var self = this;
                return LocalCollection._observeFromObserveChanges(self, options);
            },
            observeChanges: function(options) {
                var self = this;
                var ordered = LocalCollection._observeChangesCallbacksAreOrdered(options);
                if (!options._allow_unordered && !ordered && (self.skip || self.limit)) throw new Error("must use ordered observe with skip or limit");
                if (self.fields && (0 === self.fields._id || false === self.fields._id)) throw Error("You may not observe a cursor with {fields: {_id: 0}}");
                var query = {
                    matcher: self.matcher,
                    sorter: ordered && self.sorter,
                    distances: self.matcher.hasGeoQuery() && ordered && new LocalCollection._IdMap(),
                    resultsSnapshot: null,
                    ordered: ordered,
                    cursor: self,
                    projectionFn: self.projectionFn
                };
                var qid;
                if (self.reactive) {
                    qid = self.collection.next_qid++;
                    self.collection.queries[qid] = query;
                }
                query.results = self._getRawObjects({
                    ordered: ordered,
                    distances: query.distances
                });
                self.collection.paused && (query.resultsSnapshot = ordered ? [] : new LocalCollection._IdMap());
                var wrapCallback = function(f, fieldsIndex, ignoreEmptyFields) {
                    if (!f) return function() {};
                    return function() {
                        var context = this;
                        var args = arguments;
                        if (self.collection.paused) return;
                        if (void 0 !== fieldsIndex && self.projectionFn) {
                            args[fieldsIndex] = self.projectionFn(args[fieldsIndex]);
                            if (ignoreEmptyFields && _.isEmpty(args[fieldsIndex])) return;
                        }
                        self.collection._observeQueue.queueTask(function() {
                            f.apply(context, args);
                        });
                    };
                };
                query.added = wrapCallback(options.added, 1);
                query.changed = wrapCallback(options.changed, 1, true);
                query.removed = wrapCallback(options.removed);
                if (ordered) {
                    query.addedBefore = wrapCallback(options.addedBefore, 1);
                    query.movedBefore = wrapCallback(options.movedBefore);
                }
                if (!options._suppress_initial && !self.collection.paused) {
                    var each = ordered ? _.bind(_.each, null, query.results) : _.bind(query.results.forEach, query.results);
                    each(function(doc) {
                        var fields = EJSON.clone(doc);
                        delete fields._id;
                        ordered && query.addedBefore(doc._id, fields, null);
                        query.added(doc._id, fields);
                    });
                }
                var handle = new LocalCollection.ObserveHandle();
                _.extend(handle, {
                    collection: self.collection,
                    stop: function() {
                        self.reactive && delete self.collection.queries[qid];
                    }
                });
                self.reactive && Deps.active && Deps.onInvalidate(function() {
                    handle.stop();
                });
                self.collection._observeQueue.drain();
                return handle;
            }
        });
        LocalCollection.Cursor.prototype._getRawObjects = function(options) {
            var self = this;
            options = options || {};
            var results = options.ordered ? [] : new LocalCollection._IdMap();
            if (void 0 !== self._selectorId) {
                if (self.skip) return results;
                var selectedDoc = self.collection._docs.get(self._selectorId);
                selectedDoc && (options.ordered ? results.push(selectedDoc) : results.set(self._selectorId, selectedDoc));
                return results;
            }
            var distances;
            if (self.matcher.hasGeoQuery() && options.ordered) if (options.distances) {
                distances = options.distances;
                distances.clear();
            } else distances = new LocalCollection._IdMap();
            self.collection._docs.forEach(function(doc, id) {
                var matchResult = self.matcher.documentMatches(doc);
                if (matchResult.result) if (options.ordered) {
                    results.push(doc);
                    distances && void 0 !== matchResult.distance && distances.set(id, matchResult.distance);
                } else results.set(id, doc);
                if (self.limit && !self.skip && !self.sorter && results.length === self.limit) return false;
                return true;
            });
            if (!options.ordered) return results;
            if (self.sorter) {
                var comparator = self.sorter.getComparator({
                    distances: distances
                });
                results.sort(comparator);
            }
            var idx_start = self.skip || 0;
            var idx_end = self.limit ? self.limit + idx_start : results.length;
            return results.slice(idx_start, idx_end);
        };
        LocalCollection.Cursor.prototype._depend = function(changers, _allow_unordered) {
            var self = this;
            if (Deps.active) {
                var v = new Deps.Dependency();
                v.depend();
                var notifyChange = _.bind(v.changed, v);
                var options = {
                    _suppress_initial: true,
                    _allow_unordered: _allow_unordered
                };
                _.each([ "added", "changed", "removed", "addedBefore", "movedBefore" ], function(fnName) {
                    changers[fnName] && (options[fnName] = notifyChange);
                });
                self.observeChanges(options);
            }
        };
        LocalCollection.prototype.insert = function(doc, callback) {
            var self = this;
            doc = EJSON.clone(doc);
            _.has(doc, "_id") || (doc._id = LocalCollection._useOID ? new LocalCollection._ObjectID() : Random.id());
            var id = doc._id;
            if (self._docs.has(id)) throw MinimongoError("Duplicate _id '" + id + "'");
            self._saveOriginal(id, void 0);
            self._docs.set(id, doc);
            var queriesToRecompute = [];
            for (var qid in self.queries) {
                var query = self.queries[qid];
                var matchResult = query.matcher.documentMatches(doc);
                if (matchResult.result) {
                    query.distances && void 0 !== matchResult.distance && query.distances.set(id, matchResult.distance);
                    query.cursor.skip || query.cursor.limit ? queriesToRecompute.push(qid) : LocalCollection._insertInResults(query, doc);
                }
            }
            _.each(queriesToRecompute, function(qid) {
                self.queries[qid] && LocalCollection._recomputeResults(self.queries[qid]);
            });
            self._observeQueue.drain();
            callback && Meteor.defer(function() {
                callback(null, id);
            });
            return id;
        };
        LocalCollection.prototype._eachPossiblyMatchingDoc = function(selector, f) {
            var self = this;
            var specificIds = LocalCollection._idsMatchedBySelector(selector);
            if (specificIds) for (var i = 0; specificIds.length > i; ++i) {
                var id = specificIds[i];
                var doc = self._docs.get(id);
                if (doc) {
                    var breakIfFalse = f(doc, id);
                    if (false === breakIfFalse) break;
                }
            } else self._docs.forEach(f);
        };
        LocalCollection.prototype.remove = function(selector, callback) {
            var self = this;
            if (self.paused && !self._savedOriginals && EJSON.equals(selector, {})) {
                var result = self._docs.size();
                self._docs.clear();
                _.each(self.queries, function(query) {
                    query.ordered ? query.results = [] : query.results.clear();
                });
                callback && Meteor.defer(function() {
                    callback(null, result);
                });
                return result;
            }
            var matcher = new Minimongo.Matcher(selector, self);
            var remove = [];
            self._eachPossiblyMatchingDoc(selector, function(doc, id) {
                matcher.documentMatches(doc).result && remove.push(id);
            });
            var queriesToRecompute = [];
            var queryRemove = [];
            for (var i = 0; remove.length > i; i++) {
                var removeId = remove[i];
                var removeDoc = self._docs.get(removeId);
                _.each(self.queries, function(query, qid) {
                    query.matcher.documentMatches(removeDoc).result && (query.cursor.skip || query.cursor.limit ? queriesToRecompute.push(qid) : queryRemove.push({
                        qid: qid,
                        doc: removeDoc
                    }));
                });
                self._saveOriginal(removeId, removeDoc);
                self._docs.remove(removeId);
            }
            _.each(queryRemove, function(remove) {
                var query = self.queries[remove.qid];
                if (query) {
                    query.distances && query.distances.remove(remove.doc._id);
                    LocalCollection._removeFromResults(query, remove.doc);
                }
            });
            _.each(queriesToRecompute, function(qid) {
                var query = self.queries[qid];
                query && LocalCollection._recomputeResults(query);
            });
            self._observeQueue.drain();
            result = remove.length;
            callback && Meteor.defer(function() {
                callback(null, result);
            });
            return result;
        };
        LocalCollection.prototype.update = function(selector, mod, options, callback) {
            var self = this;
            if (!callback && options instanceof Function) {
                callback = options;
                options = null;
            }
            options || (options = {});
            var matcher = new Minimongo.Matcher(selector, self);
            var qidToOriginalResults = {};
            _.each(self.queries, function(query, qid) {
                !query.cursor.skip && !query.cursor.limit || query.paused || (qidToOriginalResults[qid] = EJSON.clone(query.results));
            });
            var recomputeQids = {};
            var updateCount = 0;
            self._eachPossiblyMatchingDoc(selector, function(doc, id) {
                var queryResult = matcher.documentMatches(doc);
                if (queryResult.result) {
                    self._saveOriginal(id, doc);
                    self._modifyAndNotify(doc, mod, recomputeQids, queryResult.arrayIndices);
                    ++updateCount;
                    if (!options.multi) return false;
                }
                return true;
            });
            _.each(recomputeQids, function(dummy, qid) {
                var query = self.queries[qid];
                query && LocalCollection._recomputeResults(query, qidToOriginalResults[qid]);
            });
            self._observeQueue.drain();
            var insertedId;
            if (0 === updateCount && options.upsert) {
                var newDoc = LocalCollection._removeDollarOperators(selector);
                LocalCollection._modify(newDoc, mod, {
                    isInsert: true
                });
                !newDoc._id && options.insertedId && (newDoc._id = options.insertedId);
                insertedId = self.insert(newDoc);
                updateCount = 1;
            }
            var result;
            if (options._returnObject) {
                result = {
                    numberAffected: updateCount
                };
                void 0 !== insertedId && (result.insertedId = insertedId);
            } else result = updateCount;
            callback && Meteor.defer(function() {
                callback(null, result);
            });
            return result;
        };
        LocalCollection.prototype.upsert = function(selector, mod, options, callback) {
            var self = this;
            if (!callback && "function" == typeof options) {
                callback = options;
                options = {};
            }
            return self.update(selector, mod, _.extend({}, options, {
                upsert: true,
                _returnObject: true
            }), callback);
        };
        LocalCollection.prototype._modifyAndNotify = function(doc, mod, recomputeQids, arrayIndices) {
            var self = this;
            var matched_before = {};
            for (var qid in self.queries) {
                var query = self.queries[qid];
                matched_before[qid] = query.ordered ? query.matcher.documentMatches(doc).result : query.results.has(doc._id);
            }
            var old_doc = EJSON.clone(doc);
            LocalCollection._modify(doc, mod, {
                arrayIndices: arrayIndices
            });
            for (qid in self.queries) {
                query = self.queries[qid];
                var before = matched_before[qid];
                var afterMatch = query.matcher.documentMatches(doc);
                var after = afterMatch.result;
                after && query.distances && void 0 !== afterMatch.distance && query.distances.set(doc._id, afterMatch.distance);
                query.cursor.skip || query.cursor.limit ? (before || after) && (recomputeQids[qid] = true) : before && !after ? LocalCollection._removeFromResults(query, doc) : !before && after ? LocalCollection._insertInResults(query, doc) : before && after && LocalCollection._updateInResults(query, doc, old_doc);
            }
        };
        LocalCollection._insertInResults = function(query, doc) {
            var fields = EJSON.clone(doc);
            delete fields._id;
            if (query.ordered) {
                if (query.sorter) {
                    var i = LocalCollection._insertInSortedList(query.sorter.getComparator({
                        distances: query.distances
                    }), query.results, doc);
                    var next = query.results[i + 1];
                    next = next ? next._id : null;
                    query.addedBefore(doc._id, fields, next);
                } else {
                    query.addedBefore(doc._id, fields, null);
                    query.results.push(doc);
                }
                query.added(doc._id, fields);
            } else {
                query.added(doc._id, fields);
                query.results.set(doc._id, doc);
            }
        };
        LocalCollection._removeFromResults = function(query, doc) {
            if (query.ordered) {
                var i = LocalCollection._findInOrderedResults(query, doc);
                query.removed(doc._id);
                query.results.splice(i, 1);
            } else {
                var id = doc._id;
                query.removed(doc._id);
                query.results.remove(id);
            }
        };
        LocalCollection._updateInResults = function(query, doc, old_doc) {
            if (!EJSON.equals(doc._id, old_doc._id)) throw new Error("Can't change a doc's _id while updating");
            var changedFields = LocalCollection._makeChangedFields(doc, old_doc);
            if (!query.ordered) {
                if (!_.isEmpty(changedFields)) {
                    query.changed(doc._id, changedFields);
                    query.results.set(doc._id, doc);
                }
                return;
            }
            var orig_idx = LocalCollection._findInOrderedResults(query, doc);
            _.isEmpty(changedFields) || query.changed(doc._id, changedFields);
            if (!query.sorter) return;
            query.results.splice(orig_idx, 1);
            var new_idx = LocalCollection._insertInSortedList(query.sorter.getComparator({
                distances: query.distances
            }), query.results, doc);
            if (orig_idx !== new_idx) {
                var next = query.results[new_idx + 1];
                next = next ? next._id : null;
                query.movedBefore && query.movedBefore(doc._id, next);
            }
        };
        LocalCollection._recomputeResults = function(query, oldResults) {
            oldResults || (oldResults = query.results);
            query.distances && query.distances.clear();
            query.results = query.cursor._getRawObjects({
                ordered: query.ordered,
                distances: query.distances
            });
            query.paused || LocalCollection._diffQueryChanges(query.ordered, oldResults, query.results, query);
        };
        LocalCollection._findInOrderedResults = function(query, doc) {
            if (!query.ordered) throw new Error("Can't call _findInOrderedResults on unordered query");
            for (var i = 0; query.results.length > i; i++) if (query.results[i] === doc) return i;
            throw Error("object missing from query");
        };
        LocalCollection._binarySearch = function(cmp, array, value) {
            var first = 0, rangeLength = array.length;
            while (rangeLength > 0) {
                var halfRange = Math.floor(rangeLength / 2);
                if (cmp(value, array[first + halfRange]) >= 0) {
                    first += halfRange + 1;
                    rangeLength -= halfRange + 1;
                } else rangeLength = halfRange;
            }
            return first;
        };
        LocalCollection._insertInSortedList = function(cmp, array, value) {
            if (0 === array.length) {
                array.push(value);
                return 0;
            }
            var idx = LocalCollection._binarySearch(cmp, array, value);
            array.splice(idx, 0, value);
            return idx;
        };
        LocalCollection.prototype.saveOriginals = function() {
            var self = this;
            if (self._savedOriginals) throw new Error("Called saveOriginals twice without retrieveOriginals");
            self._savedOriginals = new LocalCollection._IdMap();
        };
        LocalCollection.prototype.retrieveOriginals = function() {
            var self = this;
            if (!self._savedOriginals) throw new Error("Called retrieveOriginals without saveOriginals");
            var originals = self._savedOriginals;
            self._savedOriginals = null;
            return originals;
        };
        LocalCollection.prototype._saveOriginal = function(id, doc) {
            var self = this;
            if (!self._savedOriginals) return;
            if (self._savedOriginals.has(id)) return;
            self._savedOriginals.set(id, EJSON.clone(doc));
        };
        LocalCollection.prototype.pauseObservers = function() {
            if (this.paused) return;
            this.paused = true;
            for (var qid in this.queries) {
                var query = this.queries[qid];
                query.resultsSnapshot = EJSON.clone(query.results);
            }
        };
        LocalCollection.prototype.resumeObservers = function() {
            var self = this;
            if (!this.paused) return;
            this.paused = false;
            for (var qid in this.queries) {
                var query = self.queries[qid];
                LocalCollection._diffQueryChanges(query.ordered, query.resultsSnapshot, query.results, query);
                query.resultsSnapshot = null;
            }
            self._observeQueue.drain();
        };
        LocalCollection._idStringify = function(id) {
            if (id instanceof LocalCollection._ObjectID) return id.valueOf();
            if ("string" == typeof id) return "" === id ? id : "-" === id.substr(0, 1) || "~" === id.substr(0, 1) || LocalCollection._looksLikeObjectID(id) || "{" === id.substr(0, 1) ? "-" + id : id;
            if (void 0 === id) return "-";
            if ("object" == typeof id && null !== id) throw new Error("Meteor does not currently support objects other than ObjectID as ids");
            return "~" + JSON.stringify(id);
        };
        LocalCollection._idParse = function(id) {
            return "" === id ? id : "-" === id ? void 0 : "-" === id.substr(0, 1) ? id.substr(1) : "~" === id.substr(0, 1) ? JSON.parse(id.substr(1)) : LocalCollection._looksLikeObjectID(id) ? new LocalCollection._ObjectID(id) : id;
        };
        LocalCollection._makeChangedFields = function(newDoc, oldDoc) {
            var fields = {};
            LocalCollection._diffObjects(oldDoc, newDoc, {
                leftOnly: function(key) {
                    fields[key] = void 0;
                },
                rightOnly: function(key, value) {
                    fields[key] = value;
                },
                both: function(key, leftValue, rightValue) {
                    EJSON.equals(leftValue, rightValue) || (fields[key] = rightValue);
                }
            });
            return fields;
        };
    }).call(this);
    (function() {
        LocalCollection.wrapTransform = function(transform) {
            if (!transform) return null;
            return function(doc) {
                if (!_.has(doc, "_id")) throw new Error("can only transform documents with _id");
                var id = doc._id;
                var transformed = Deps.nonreactive(function() {
                    return transform(doc);
                });
                if (!isPlainObject(transformed)) throw new Error("transform must return object");
                if (_.has(transformed, "_id")) {
                    if (!EJSON.equals(transformed._id, id)) throw new Error("transformed document can't have different _id");
                } else transformed._id = id;
                return transformed;
            };
        };
    }).call(this);
    (function() {
        isArray = function(x) {
            return _.isArray(x) && !EJSON.isBinary(x);
        };
        isPlainObject = LocalCollection._isPlainObject = function(x) {
            return x && 3 === LocalCollection._f._type(x);
        };
        isIndexable = function(x) {
            return isArray(x) || isPlainObject(x);
        };
        isOperatorObject = function(valueSelector, inconsistentOK) {
            if (!isPlainObject(valueSelector)) return false;
            var theseAreOperators = void 0;
            _.each(valueSelector, function(value, selKey) {
                var thisIsOperator = "$" === selKey.substr(0, 1);
                if (void 0 === theseAreOperators) theseAreOperators = thisIsOperator; else if (theseAreOperators !== thisIsOperator) {
                    if (!inconsistentOK) throw new Error("Inconsistent operator: " + JSON.stringify(valueSelector));
                    theseAreOperators = false;
                }
            });
            return !!theseAreOperators;
        };
        isNumericKey = function(s) {
            return /^[0-9]+$/.test(s);
        };
    }).call(this);
    (function() {
        Minimongo.Matcher = function(selector) {
            var self = this;
            self._paths = {};
            self._hasGeoQuery = false;
            self._hasWhere = false;
            self._isSimple = true;
            self._matchingDocument = void 0;
            self._selector = null;
            self._docMatcher = self._compileSelector(selector);
        };
        _.extend(Minimongo.Matcher.prototype, {
            documentMatches: function(doc) {
                if (!doc || "object" != typeof doc) throw Error("documentMatches needs a document");
                return this._docMatcher(doc);
            },
            hasGeoQuery: function() {
                return this._hasGeoQuery;
            },
            hasWhere: function() {
                return this._hasWhere;
            },
            isSimple: function() {
                return this._isSimple;
            },
            _compileSelector: function(selector) {
                var self = this;
                if (selector instanceof Function) {
                    self._isSimple = false;
                    self._selector = selector;
                    self._recordPathUsed("");
                    return function(doc) {
                        return {
                            result: !!selector.call(doc)
                        };
                    };
                }
                if (LocalCollection._selectorIsId(selector)) {
                    self._selector = {
                        _id: selector
                    };
                    self._recordPathUsed("_id");
                    return function(doc) {
                        return {
                            result: EJSON.equals(doc._id, selector)
                        };
                    };
                }
                if (!selector || "_id" in selector && !selector._id) {
                    self._isSimple = false;
                    return nothingMatcher;
                }
                if ("boolean" == typeof selector || isArray(selector) || EJSON.isBinary(selector)) throw new Error("Invalid selector: " + selector);
                self._selector = EJSON.clone(selector);
                return compileDocumentSelector(selector, self, {
                    isRoot: true
                });
            },
            _recordPathUsed: function(path) {
                this._paths[path] = true;
            },
            _getPaths: function() {
                return _.keys(this._paths);
            }
        });
        var compileDocumentSelector = function(docSelector, matcher, options) {
            options = options || {};
            var docMatchers = [];
            _.each(docSelector, function(subSelector, key) {
                if ("$" === key.substr(0, 1)) {
                    if (!_.has(LOGICAL_OPERATORS, key)) throw new Error("Unrecognized logical operator: " + key);
                    matcher._isSimple = false;
                    docMatchers.push(LOGICAL_OPERATORS[key](subSelector, matcher, options.inElemMatch));
                } else {
                    options.inElemMatch || matcher._recordPathUsed(key);
                    var lookUpByIndex = makeLookupFunction(key);
                    var valueMatcher = compileValueSelector(subSelector, matcher, options.isRoot);
                    docMatchers.push(function(doc) {
                        var branchValues = lookUpByIndex(doc);
                        return valueMatcher(branchValues);
                    });
                }
            });
            return andDocumentMatchers(docMatchers);
        };
        var compileValueSelector = function(valueSelector, matcher, isRoot) {
            if (valueSelector instanceof RegExp) {
                matcher._isSimple = false;
                return convertElementMatcherToBranchedMatcher(regexpElementMatcher(valueSelector));
            }
            return isOperatorObject(valueSelector) ? operatorBranchedMatcher(valueSelector, matcher, isRoot) : convertElementMatcherToBranchedMatcher(equalityElementMatcher(valueSelector));
        };
        var convertElementMatcherToBranchedMatcher = function(elementMatcher, options) {
            options = options || {};
            return function(branches) {
                var expanded = branches;
                options.dontExpandLeafArrays || (expanded = expandArraysInBranches(branches, options.dontIncludeLeafArrays));
                var ret = {};
                ret.result = _.any(expanded, function(element) {
                    var matched = elementMatcher(element.value);
                    if ("number" == typeof matched) {
                        element.arrayIndices || (element.arrayIndices = [ matched ]);
                        matched = true;
                    }
                    matched && element.arrayIndices && (ret.arrayIndices = element.arrayIndices);
                    return matched;
                });
                return ret;
            };
        };
        regexpElementMatcher = function(regexp) {
            return function(value) {
                if (value instanceof RegExp) return _.isEqual(value, regexp);
                if ("string" != typeof value) return false;
                return regexp.test(value);
            };
        };
        equalityElementMatcher = function(elementSelector) {
            if (isOperatorObject(elementSelector)) throw Error("Can't create equalityValueSelector for operator object");
            if (null == elementSelector) return function(value) {
                return null == value;
            };
            return function(value) {
                return LocalCollection._f._equal(elementSelector, value);
            };
        };
        var operatorBranchedMatcher = function(valueSelector, matcher, isRoot) {
            var operatorMatchers = [];
            _.each(valueSelector, function(operand, operator) {
                var simpleRange = _.contains([ "$lt", "$lte", "$gt", "$gte" ], operator) && _.isNumber(operand);
                var simpleInequality = "$ne" === operator && !_.isObject(operand);
                var simpleInclusion = _.contains([ "$in", "$nin" ], operator) && _.isArray(operand) && !_.any(operand, _.isObject);
                "$eq" === operator || simpleRange || simpleInclusion || simpleInequality || (matcher._isSimple = false);
                if (_.has(VALUE_OPERATORS, operator)) operatorMatchers.push(VALUE_OPERATORS[operator](operand, valueSelector, matcher, isRoot)); else {
                    if (!_.has(ELEMENT_OPERATORS, operator)) throw new Error("Unrecognized operator: " + operator);
                    var options = ELEMENT_OPERATORS[operator];
                    operatorMatchers.push(convertElementMatcherToBranchedMatcher(options.compileElementSelector(operand, valueSelector, matcher), options));
                }
            });
            return andBranchedMatchers(operatorMatchers);
        };
        var compileArrayOfDocumentSelectors = function(selectors, matcher, inElemMatch) {
            if (!isArray(selectors) || _.isEmpty(selectors)) throw Error("$and/$or/$nor must be nonempty array");
            return _.map(selectors, function(subSelector) {
                if (!isPlainObject(subSelector)) throw Error("$or/$and/$nor entries need to be full objects");
                return compileDocumentSelector(subSelector, matcher, {
                    inElemMatch: inElemMatch
                });
            });
        };
        var LOGICAL_OPERATORS = {
            $and: function(subSelector, matcher, inElemMatch) {
                var matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch);
                return andDocumentMatchers(matchers);
            },
            $or: function(subSelector, matcher, inElemMatch) {
                var matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch);
                if (1 === matchers.length) return matchers[0];
                return function(doc) {
                    var result = _.any(matchers, function(f) {
                        return f(doc).result;
                    });
                    return {
                        result: result
                    };
                };
            },
            $nor: function(subSelector, matcher, inElemMatch) {
                var matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch);
                return function(doc) {
                    var result = _.all(matchers, function(f) {
                        return !f(doc).result;
                    });
                    return {
                        result: result
                    };
                };
            },
            $where: function(selectorValue, matcher) {
                matcher._recordPathUsed("");
                matcher._hasWhere = true;
                selectorValue instanceof Function || (selectorValue = Function("obj", "return " + selectorValue));
                return function(doc) {
                    return {
                        result: selectorValue.call(doc, doc)
                    };
                };
            },
            $comment: function() {
                return function() {
                    return {
                        result: true
                    };
                };
            }
        };
        var invertBranchedMatcher = function(branchedMatcher) {
            return function(branchValues) {
                var invertMe = branchedMatcher(branchValues);
                return {
                    result: !invertMe.result
                };
            };
        };
        var VALUE_OPERATORS = {
            $not: function(operand, valueSelector, matcher) {
                return invertBranchedMatcher(compileValueSelector(operand, matcher));
            },
            $ne: function(operand) {
                return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(equalityElementMatcher(operand)));
            },
            $nin: function(operand) {
                return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(ELEMENT_OPERATORS.$in.compileElementSelector(operand)));
            },
            $exists: function(operand) {
                var exists = convertElementMatcherToBranchedMatcher(function(value) {
                    return void 0 !== value;
                });
                return operand ? exists : invertBranchedMatcher(exists);
            },
            $options: function(operand, valueSelector) {
                if (!_.has(valueSelector, "$regex")) throw Error("$options needs a $regex");
                return everythingMatcher;
            },
            $maxDistance: function(operand, valueSelector) {
                if (!valueSelector.$near) throw Error("$maxDistance needs a $near");
                return everythingMatcher;
            },
            $all: function(operand, valueSelector, matcher) {
                if (!isArray(operand)) throw Error("$all requires array");
                if (_.isEmpty(operand)) return nothingMatcher;
                var branchedMatchers = [];
                _.each(operand, function(criterion) {
                    if (isOperatorObject(criterion)) throw Error("no $ expressions in $all");
                    branchedMatchers.push(compileValueSelector(criterion, matcher));
                });
                return andBranchedMatchers(branchedMatchers);
            },
            $near: function(operand, valueSelector, matcher, isRoot) {
                if (!isRoot) throw Error("$near can't be inside another $ operator");
                matcher._hasGeoQuery = true;
                var maxDistance, point, distance;
                if (isPlainObject(operand) && _.has(operand, "$geometry")) {
                    maxDistance = operand.$maxDistance;
                    point = operand.$geometry;
                    distance = function(value) {
                        if (!value || !value.type) return null;
                        return "Point" === value.type ? GeoJSON.pointDistance(point, value) : GeoJSON.geometryWithinRadius(value, point, maxDistance) ? 0 : maxDistance + 1;
                    };
                } else {
                    maxDistance = valueSelector.$maxDistance;
                    if (!isArray(operand) && !isPlainObject(operand)) throw Error("$near argument must be coordinate pair or GeoJSON");
                    point = pointToArray(operand);
                    distance = function(value) {
                        if (!isArray(value) && !isPlainObject(value)) return null;
                        return distanceCoordinatePairs(point, value);
                    };
                }
                return function(branchedValues) {
                    branchedValues = expandArraysInBranches(branchedValues);
                    var result = {
                        result: false
                    };
                    _.each(branchedValues, function(branch) {
                        var curDistance = distance(branch.value);
                        if (null === curDistance || curDistance > maxDistance) return;
                        if (void 0 !== result.distance && curDistance >= result.distance) return;
                        result.result = true;
                        result.distance = curDistance;
                        branch.arrayIndices ? result.arrayIndices = branch.arrayIndices : delete result.arrayIndices;
                    });
                    return result;
                };
            }
        };
        var distanceCoordinatePairs = function(a, b) {
            a = pointToArray(a);
            b = pointToArray(b);
            var x = a[0] - b[0];
            var y = a[1] - b[1];
            if (_.isNaN(x) || _.isNaN(y)) return null;
            return Math.sqrt(x * x + y * y);
        };
        var pointToArray = function(point) {
            return _.map(point, _.identity);
        };
        var makeInequality = function(cmpValueComparator) {
            return {
                compileElementSelector: function(operand) {
                    if (isArray(operand)) return function() {
                        return false;
                    };
                    void 0 === operand && (operand = null);
                    var operandType = LocalCollection._f._type(operand);
                    return function(value) {
                        void 0 === value && (value = null);
                        if (LocalCollection._f._type(value) !== operandType) return false;
                        return cmpValueComparator(LocalCollection._f._cmp(value, operand));
                    };
                }
            };
        };
        ELEMENT_OPERATORS = {
            $lt: makeInequality(function(cmpValue) {
                return 0 > cmpValue;
            }),
            $gt: makeInequality(function(cmpValue) {
                return cmpValue > 0;
            }),
            $lte: makeInequality(function(cmpValue) {
                return 0 >= cmpValue;
            }),
            $gte: makeInequality(function(cmpValue) {
                return cmpValue >= 0;
            }),
            $mod: {
                compileElementSelector: function(operand) {
                    if (!(isArray(operand) && 2 === operand.length && "number" == typeof operand[0] && "number" == typeof operand[1])) throw Error("argument to $mod must be an array of two numbers");
                    var divisor = operand[0];
                    var remainder = operand[1];
                    return function(value) {
                        return "number" == typeof value && value % divisor === remainder;
                    };
                }
            },
            $in: {
                compileElementSelector: function(operand) {
                    if (!isArray(operand)) throw Error("$in needs an array");
                    var elementMatchers = [];
                    _.each(operand, function(option) {
                        if (option instanceof RegExp) elementMatchers.push(regexpElementMatcher(option)); else {
                            if (isOperatorObject(option)) throw Error("cannot nest $ under $in");
                            elementMatchers.push(equalityElementMatcher(option));
                        }
                    });
                    return function(value) {
                        void 0 === value && (value = null);
                        return _.any(elementMatchers, function(e) {
                            return e(value);
                        });
                    };
                }
            },
            $size: {
                dontExpandLeafArrays: true,
                compileElementSelector: function(operand) {
                    if ("string" == typeof operand) operand = 0; else if ("number" != typeof operand) throw Error("$size needs a number");
                    return function(value) {
                        return isArray(value) && value.length === operand;
                    };
                }
            },
            $type: {
                dontIncludeLeafArrays: true,
                compileElementSelector: function(operand) {
                    if ("number" != typeof operand) throw Error("$type needs a number");
                    return function(value) {
                        return void 0 !== value && LocalCollection._f._type(value) === operand;
                    };
                }
            },
            $regex: {
                compileElementSelector: function(operand, valueSelector) {
                    if (!("string" == typeof operand || operand instanceof RegExp)) throw Error("$regex has to be a string or RegExp");
                    var regexp;
                    if (void 0 !== valueSelector.$options) {
                        if (/[^gim]/.test(valueSelector.$options)) throw new Error("Only the i, m, and g regexp options are supported");
                        var regexSource = operand instanceof RegExp ? operand.source : operand;
                        regexp = new RegExp(regexSource, valueSelector.$options);
                    } else regexp = operand instanceof RegExp ? operand : new RegExp(operand);
                    return regexpElementMatcher(regexp);
                }
            },
            $elemMatch: {
                dontExpandLeafArrays: true,
                compileElementSelector: function(operand, valueSelector, matcher) {
                    if (!isPlainObject(operand)) throw Error("$elemMatch need an object");
                    var subMatcher, isDocMatcher;
                    if (isOperatorObject(operand, true)) {
                        subMatcher = compileValueSelector(operand, matcher);
                        isDocMatcher = false;
                    } else {
                        subMatcher = compileDocumentSelector(operand, matcher, {
                            inElemMatch: true
                        });
                        isDocMatcher = true;
                    }
                    return function(value) {
                        if (!isArray(value)) return false;
                        for (var i = 0; value.length > i; ++i) {
                            var arrayElement = value[i];
                            var arg;
                            if (isDocMatcher) {
                                if (!isPlainObject(arrayElement) && !isArray(arrayElement)) return false;
                                arg = arrayElement;
                            } else arg = [ {
                                value: arrayElement,
                                dontIterate: true
                            } ];
                            if (subMatcher(arg).result) return i;
                        }
                        return false;
                    };
                }
            }
        };
        makeLookupFunction = function(key) {
            var parts = key.split(".");
            var firstPart = parts.length ? parts[0] : "";
            var firstPartIsNumeric = isNumericKey(firstPart);
            var lookupRest;
            parts.length > 1 && (lookupRest = makeLookupFunction(parts.slice(1).join(".")));
            var elideUnnecessaryFields = function(retVal) {
                retVal.dontIterate || delete retVal.dontIterate;
                retVal.arrayIndices && !retVal.arrayIndices.length && delete retVal.arrayIndices;
                return retVal;
            };
            return function(doc, arrayIndices) {
                arrayIndices || (arrayIndices = []);
                if (isArray(doc)) {
                    if (!(firstPartIsNumeric && doc.length > firstPart)) return [];
                    arrayIndices = arrayIndices.concat(+firstPart, "x");
                }
                var firstLevel = doc[firstPart];
                if (!lookupRest) return [ elideUnnecessaryFields({
                    value: firstLevel,
                    dontIterate: isArray(doc) && isArray(firstLevel),
                    arrayIndices: arrayIndices
                }) ];
                if (!isIndexable(firstLevel)) {
                    if (isArray(doc)) return [];
                    return [ elideUnnecessaryFields({
                        value: void 0,
                        arrayIndices: arrayIndices
                    }) ];
                }
                var result = [];
                var appendToResult = function(more) {
                    Array.prototype.push.apply(result, more);
                };
                appendToResult(lookupRest(firstLevel, arrayIndices));
                isArray(firstLevel) && _.each(firstLevel, function(branch, arrayIndex) {
                    isPlainObject(branch) && appendToResult(lookupRest(branch, arrayIndices.concat(arrayIndex)));
                });
                return result;
            };
        };
        MinimongoTest.makeLookupFunction = makeLookupFunction;
        expandArraysInBranches = function(branches, skipTheArrays) {
            var branchesOut = [];
            _.each(branches, function(branch) {
                var thisIsArray = isArray(branch.value);
                skipTheArrays && thisIsArray && !branch.dontIterate || branchesOut.push({
                    value: branch.value,
                    arrayIndices: branch.arrayIndices
                });
                thisIsArray && !branch.dontIterate && _.each(branch.value, function(leaf, i) {
                    branchesOut.push({
                        value: leaf,
                        arrayIndices: (branch.arrayIndices || []).concat(i)
                    });
                });
            });
            return branchesOut;
        };
        var nothingMatcher = function() {
            return {
                result: false
            };
        };
        var everythingMatcher = function() {
            return {
                result: true
            };
        };
        var andSomeMatchers = function(subMatchers) {
            if (0 === subMatchers.length) return everythingMatcher;
            if (1 === subMatchers.length) return subMatchers[0];
            return function(docOrBranches) {
                var ret = {};
                ret.result = _.all(subMatchers, function(f) {
                    var subResult = f(docOrBranches);
                    subResult.result && void 0 !== subResult.distance && void 0 === ret.distance && (ret.distance = subResult.distance);
                    subResult.result && subResult.arrayIndices && (ret.arrayIndices = subResult.arrayIndices);
                    return subResult.result;
                });
                if (!ret.result) {
                    delete ret.distance;
                    delete ret.arrayIndices;
                }
                return ret;
            };
        };
        var andDocumentMatchers = andSomeMatchers;
        var andBranchedMatchers = andSomeMatchers;
        LocalCollection._f = {
            _type: function(v) {
                if ("number" == typeof v) return 1;
                if ("string" == typeof v) return 2;
                if ("boolean" == typeof v) return 8;
                if (isArray(v)) return 4;
                if (null === v) return 10;
                if (v instanceof RegExp) return 11;
                if ("function" == typeof v) return 13;
                if (v instanceof Date) return 9;
                if (EJSON.isBinary(v)) return 5;
                if (v instanceof LocalCollection._ObjectID) return 7;
                return 3;
            },
            _equal: function(a, b) {
                return EJSON.equals(a, b, {
                    keyOrderSensitive: true
                });
            },
            _typeorder: function(t) {
                return [ -1, 1, 2, 3, 4, 5, -1, 6, 7, 8, 0, 9, -1, 100, 2, 100, 1, 8, 1 ][t];
            },
            _cmp: function(a, b) {
                if (void 0 === a) return void 0 === b ? 0 : -1;
                if (void 0 === b) return 1;
                var ta = LocalCollection._f._type(a);
                var tb = LocalCollection._f._type(b);
                var oa = LocalCollection._f._typeorder(ta);
                var ob = LocalCollection._f._typeorder(tb);
                if (oa !== ob) return ob > oa ? -1 : 1;
                if (ta !== tb) throw Error("Missing type coercion logic in _cmp");
                if (7 === ta) {
                    ta = tb = 2;
                    a = a.toHexString();
                    b = b.toHexString();
                }
                if (9 === ta) {
                    ta = tb = 1;
                    a = a.getTime();
                    b = b.getTime();
                }
                if (1 === ta) return a - b;
                if (2 === tb) return b > a ? -1 : a === b ? 0 : 1;
                if (3 === ta) {
                    var to_array = function(obj) {
                        var ret = [];
                        for (var key in obj) {
                            ret.push(key);
                            ret.push(obj[key]);
                        }
                        return ret;
                    };
                    return LocalCollection._f._cmp(to_array(a), to_array(b));
                }
                if (4 === ta) for (var i = 0; ;i++) {
                    if (i === a.length) return i === b.length ? 0 : -1;
                    if (i === b.length) return 1;
                    var s = LocalCollection._f._cmp(a[i], b[i]);
                    if (0 !== s) return s;
                }
                if (5 === ta) {
                    if (a.length !== b.length) return a.length - b.length;
                    for (i = 0; a.length > i; i++) {
                        if (a[i] < b[i]) return -1;
                        if (a[i] > b[i]) return 1;
                    }
                    return 0;
                }
                if (8 === ta) {
                    if (a) return b ? 0 : 1;
                    return b ? -1 : 0;
                }
                if (10 === ta) return 0;
                if (11 === ta) throw Error("Sorting not supported on regular expression");
                if (13 === ta) throw Error("Sorting not supported on Javascript code");
                throw Error("Unknown type to sort");
            }
        };
        LocalCollection._removeDollarOperators = function(selector) {
            var selectorDoc = {};
            for (var k in selector) "$" !== k.substr(0, 1) && (selectorDoc[k] = selector[k]);
            return selectorDoc;
        };
    }).call(this);
    (function() {
        Minimongo.Sorter = function(spec, options) {
            var self = this;
            options = options || {};
            self._sortSpecParts = [];
            var addSpecPart = function(path, ascending) {
                if (!path) throw Error("sort keys must be non-empty");
                if ("$" === path.charAt(0)) throw Error("unsupported sort key: " + path);
                self._sortSpecParts.push({
                    path: path,
                    lookup: makeLookupFunction(path),
                    ascending: ascending
                });
            };
            if (spec instanceof Array) for (var i = 0; spec.length > i; i++) "string" == typeof spec[i] ? addSpecPart(spec[i], true) : addSpecPart(spec[i][0], "desc" !== spec[i][1]); else {
                if ("object" != typeof spec) throw Error("Bad sort specification: " + JSON.stringify(spec));
                _.each(spec, function(value, key) {
                    addSpecPart(key, value >= 0);
                });
            }
            if (self.affectedByModifier) {
                var selector = {};
                _.each(self._sortSpecParts, function(spec) {
                    selector[spec.path] = 1;
                });
                self._selectorForAffectedByModifier = new Minimongo.Matcher(selector);
            }
            self._keyComparator = composeComparators(_.map(self._sortSpecParts, function(spec, i) {
                return self._keyFieldComparator(i);
            }));
            self._keyFilter = null;
            options.matcher && self._useWithMatcher(options.matcher);
        };
        _.extend(Minimongo.Sorter.prototype, {
            getComparator: function(options) {
                var self = this;
                if (!options || !options.distances) return self._getBaseComparator();
                var distances = options.distances;
                return composeComparators([ self._getBaseComparator(), function(a, b) {
                    if (!distances.has(a._id)) throw Error("Missing distance for " + a._id);
                    if (!distances.has(b._id)) throw Error("Missing distance for " + b._id);
                    return distances.get(a._id) - distances.get(b._id);
                } ]);
            },
            _getPaths: function() {
                var self = this;
                return _.pluck(self._sortSpecParts, "path");
            },
            _getMinKeyFromDoc: function(doc) {
                var self = this;
                var minKey = null;
                self._generateKeysFromDoc(doc, function(key) {
                    if (!self._keyCompatibleWithSelector(key)) return;
                    if (null === minKey) {
                        minKey = key;
                        return;
                    }
                    0 > self._compareKeys(key, minKey) && (minKey = key);
                });
                if (null === minKey) throw Error("sort selector found no keys in doc?");
                return minKey;
            },
            _keyCompatibleWithSelector: function(key) {
                var self = this;
                return !self._keyFilter || self._keyFilter(key);
            },
            _generateKeysFromDoc: function(doc, cb) {
                var self = this;
                if (0 === self._sortSpecParts.length) throw new Error("can't generate keys without a spec");
                var valuesByIndexAndPath = [];
                var pathFromIndices = function(indices) {
                    return indices.join(",") + ",";
                };
                var knownPaths = null;
                _.each(self._sortSpecParts, function(spec, whichField) {
                    var branches = expandArraysInBranches(spec.lookup(doc), true);
                    branches.length || (branches = [ {
                        value: null
                    } ]);
                    var usedPaths = false;
                    valuesByIndexAndPath[whichField] = {};
                    _.each(branches, function(branch) {
                        if (!branch.arrayIndices) {
                            if (branches.length > 1) throw Error("multiple branches but no array used?");
                            valuesByIndexAndPath[whichField][""] = branch.value;
                            return;
                        }
                        usedPaths = true;
                        var path = pathFromIndices(branch.arrayIndices);
                        if (_.has(valuesByIndexAndPath[whichField], path)) throw Error("duplicate path: " + path);
                        valuesByIndexAndPath[whichField][path] = branch.value;
                        if (knownPaths && !_.has(knownPaths, path)) throw Error("cannot index parallel arrays");
                    });
                    if (knownPaths) {
                        if (!_.has(valuesByIndexAndPath[whichField], "") && _.size(knownPaths) !== _.size(valuesByIndexAndPath[whichField])) throw Error("cannot index parallel arrays!");
                    } else if (usedPaths) {
                        knownPaths = {};
                        _.each(valuesByIndexAndPath[whichField], function(x, path) {
                            knownPaths[path] = true;
                        });
                    }
                });
                if (!knownPaths) {
                    var soleKey = _.map(valuesByIndexAndPath, function(values) {
                        if (!_.has(values, "")) throw Error("no value in sole key case?");
                        return values[""];
                    });
                    cb(soleKey);
                    return;
                }
                _.each(knownPaths, function(x, path) {
                    var key = _.map(valuesByIndexAndPath, function(values) {
                        if (_.has(values, "")) return values[""];
                        if (!_.has(values, path)) throw Error("missing path?");
                        return values[path];
                    });
                    cb(key);
                });
            },
            _compareKeys: function(key1, key2) {
                var self = this;
                if (key1.length !== self._sortSpecParts.length || key2.length !== self._sortSpecParts.length) throw Error("Key has wrong length");
                return self._keyComparator(key1, key2);
            },
            _keyFieldComparator: function(i) {
                var self = this;
                var invert = !self._sortSpecParts[i].ascending;
                return function(key1, key2) {
                    var compare = LocalCollection._f._cmp(key1[i], key2[i]);
                    invert && (compare = -compare);
                    return compare;
                };
            },
            _getBaseComparator: function() {
                var self = this;
                if (!self._sortSpecParts.length) return function() {
                    return 0;
                };
                return function(doc1, doc2) {
                    var key1 = self._getMinKeyFromDoc(doc1);
                    var key2 = self._getMinKeyFromDoc(doc2);
                    return self._compareKeys(key1, key2);
                };
            },
            _useWithMatcher: function(matcher) {
                var self = this;
                if (self._keyFilter) throw Error("called _useWithMatcher twice?");
                if (_.isEmpty(self._sortSpecParts)) return;
                var selector = matcher._selector;
                if (selector instanceof Function) return;
                var constraintsByPath = {};
                _.each(self._sortSpecParts, function(spec) {
                    constraintsByPath[spec.path] = [];
                });
                _.each(selector, function(subSelector, key) {
                    var constraints = constraintsByPath[key];
                    if (!constraints) return;
                    if (subSelector instanceof RegExp) {
                        if (subSelector.ignoreCase || subSelector.multiline) return;
                        constraints.push(regexpElementMatcher(subSelector));
                        return;
                    }
                    if (isOperatorObject(subSelector)) {
                        _.each(subSelector, function(operand, operator) {
                            _.contains([ "$lt", "$lte", "$gt", "$gte" ], operator) && constraints.push(ELEMENT_OPERATORS[operator].compileElementSelector(operand));
                            "$regex" !== operator || subSelector.$options || constraints.push(ELEMENT_OPERATORS.$regex.compileElementSelector(operand, subSelector));
                        });
                        return;
                    }
                    constraints.push(equalityElementMatcher(subSelector));
                });
                if (_.isEmpty(constraintsByPath[self._sortSpecParts[0].path])) return;
                self._keyFilter = function(key) {
                    return _.all(self._sortSpecParts, function(specPart, index) {
                        return _.all(constraintsByPath[specPart.path], function(f) {
                            return f(key[index]);
                        });
                    });
                };
            }
        });
        var composeComparators = function(comparatorArray) {
            return function(a, b) {
                for (var i = 0; comparatorArray.length > i; ++i) {
                    var compare = comparatorArray[i](a, b);
                    if (0 !== compare) return compare;
                }
                return 0;
            };
        };
    }).call(this);
    (function() {
        LocalCollection._compileProjection = function(fields) {
            LocalCollection._checkSupportedProjection(fields);
            var _idProjection = _.isUndefined(fields._id) ? true : fields._id;
            var details = projectionDetails(fields);
            var transform = function(doc, ruleTree) {
                if (_.isArray(doc)) return _.map(doc, function(subdoc) {
                    return transform(subdoc, ruleTree);
                });
                var res = details.including ? {} : EJSON.clone(doc);
                _.each(ruleTree, function(rule, key) {
                    if (!_.has(doc, key)) return;
                    _.isObject(rule) ? _.isObject(doc[key]) && (res[key] = transform(doc[key], rule)) : details.including ? res[key] = EJSON.clone(doc[key]) : delete res[key];
                });
                return res;
            };
            return function(obj) {
                var res = transform(obj, details.tree);
                _idProjection && _.has(obj, "_id") && (res._id = obj._id);
                !_idProjection && _.has(res, "_id") && delete res._id;
                return res;
            };
        };
        projectionDetails = function(fields) {
            var fieldsKeys = _.keys(fields).sort();
            fieldsKeys.length > 0 && !(1 === fieldsKeys.length && "_id" === fieldsKeys[0]) && (fieldsKeys = _.reject(fieldsKeys, function(key) {
                return "_id" === key;
            }));
            var including = null;
            _.each(fieldsKeys, function(keyPath) {
                var rule = !!fields[keyPath];
                null === including && (including = rule);
                if (including !== rule) throw MinimongoError("You cannot currently mix including and excluding fields.");
            });
            var projectionRulesTree = pathsToTree(fieldsKeys, function() {
                return including;
            }, function(node, path, fullPath) {
                var currentPath = fullPath;
                var anotherPath = path;
                throw MinimongoError("both " + currentPath + " and " + anotherPath + " found in fields option, using both of them may trigger " + "unexpected behavior. Did you mean to use only one of them?");
            });
            return {
                tree: projectionRulesTree,
                including: including
            };
        };
        pathsToTree = function(paths, newLeafFn, conflictFn, tree) {
            tree = tree || {};
            _.each(paths, function(keyPath) {
                var treePos = tree;
                var pathArr = keyPath.split(".");
                var success = _.all(pathArr.slice(0, -1), function(key, idx) {
                    if (_.has(treePos, key)) {
                        if (!_.isObject(treePos[key])) {
                            treePos[key] = conflictFn(treePos[key], pathArr.slice(0, idx + 1).join("."), keyPath);
                            if (!_.isObject(treePos[key])) return false;
                        }
                    } else treePos[key] = {};
                    treePos = treePos[key];
                    return true;
                });
                if (success) {
                    var lastKey = _.last(pathArr);
                    treePos[lastKey] = _.has(treePos, lastKey) ? conflictFn(treePos[lastKey], keyPath, keyPath) : newLeafFn(keyPath);
                }
            });
            return tree;
        };
        LocalCollection._checkSupportedProjection = function(fields) {
            if (!_.isObject(fields) || _.isArray(fields)) throw MinimongoError("fields option must be an object");
            _.each(fields, function(val, keyPath) {
                if (_.contains(keyPath.split("."), "$")) throw MinimongoError("Minimongo doesn't support $ operator in projections yet.");
                if (-1 === _.indexOf([ 1, 0, true, false ], val)) throw MinimongoError("Projection values should be one of 1, 0, true, or false");
            });
        };
    }).call(this);
    (function() {
        LocalCollection._modify = function(doc, mod, options) {
            options = options || {};
            if (!isPlainObject(mod)) throw MinimongoError("Modifier must be an object");
            var isModifier = isOperatorObject(mod);
            var newDoc;
            if (isModifier) {
                newDoc = EJSON.clone(doc);
                _.each(mod, function(operand, op) {
                    var modFunc = MODIFIERS[op];
                    options.isInsert && "$setOnInsert" === op && (modFunc = MODIFIERS["$set"]);
                    if (!modFunc) throw MinimongoError("Invalid modifier specified " + op);
                    _.each(operand, function(arg, keypath) {
                        if (keypath.length && "." === keypath[keypath.length - 1]) throw MinimongoError("Invalid mod field name, may not end in a period");
                        if ("_id" === keypath) throw MinimongoError("Mod on _id not allowed");
                        var keyparts = keypath.split(".");
                        _.has(NO_CREATE_MODIFIERS, op);
                        var target = findModTarget(newDoc, keyparts, {
                            noCreate: NO_CREATE_MODIFIERS[op],
                            forbidArray: "$rename" === op,
                            arrayIndices: options.arrayIndices
                        });
                        var field = keyparts.pop();
                        modFunc(target, field, arg, keypath, newDoc);
                    });
                });
            } else {
                if (mod._id && !EJSON.equals(doc._id, mod._id)) throw MinimongoError("Cannot change the _id of a document");
                for (var k in mod) if (/\./.test(k)) throw MinimongoError("When replacing document, field name may not contain '.'");
                newDoc = mod;
            }
            _.each(_.keys(doc), function(k) {
                ("_id" !== k || options.isInsert) && delete doc[k];
            });
            _.each(newDoc, function(v, k) {
                doc[k] = v;
            });
        };
        var findModTarget = function(doc, keyparts, options) {
            options = options || {};
            var usedArrayIndex = false;
            for (var i = 0; keyparts.length > i; i++) {
                var last = i === keyparts.length - 1;
                var keypart = keyparts[i];
                var indexable = isIndexable(doc);
                if (!indexable) {
                    if (options.noCreate) return void 0;
                    var e = MinimongoError("cannot use the part '" + keypart + "' to traverse " + doc);
                    e.setPropertyError = true;
                    throw e;
                }
                if (doc instanceof Array) {
                    if (options.forbidArray) return null;
                    if ("$" === keypart) {
                        if (usedArrayIndex) throw MinimongoError("Too many positional (i.e. '$') elements");
                        if (!options.arrayIndices || !options.arrayIndices.length) throw MinimongoError("The positional operator did not find the match needed from the query");
                        keypart = options.arrayIndices[0];
                        usedArrayIndex = true;
                    } else {
                        if (!isNumericKey(keypart)) {
                            if (options.noCreate) return void 0;
                            throw MinimongoError("can't append to array using string field name [" + keypart + "]");
                        }
                        keypart = parseInt(keypart);
                    }
                    last && (keyparts[i] = keypart);
                    if (options.noCreate && keypart >= doc.length) return void 0;
                    while (keypart > doc.length) doc.push(null);
                    if (!last) if (doc.length === keypart) doc.push({}); else if ("object" != typeof doc[keypart]) throw MinimongoError("can't modify field '" + keyparts[i + 1] + "' of list value " + JSON.stringify(doc[keypart]));
                } else {
                    if (keypart.length && "$" === keypart.substr(0, 1)) throw MinimongoError("can't set field named " + keypart);
                    if (!(keypart in doc)) {
                        if (options.noCreate) return void 0;
                        last || (doc[keypart] = {});
                    }
                }
                if (last) return doc;
                doc = doc[keypart];
            }
        };
        var NO_CREATE_MODIFIERS = {
            $unset: true,
            $pop: true,
            $rename: true,
            $pull: true,
            $pullAll: true
        };
        var MODIFIERS = {
            $inc: function(target, field, arg) {
                if ("number" != typeof arg) throw MinimongoError("Modifier $inc allowed for numbers only");
                if (field in target) {
                    if ("number" != typeof target[field]) throw MinimongoError("Cannot apply $inc modifier to non-number");
                    target[field] += arg;
                } else target[field] = arg;
            },
            $set: function(target, field, arg) {
                if (!_.isObject(target)) {
                    var e = MinimongoError("Cannot set property on non-object field");
                    e.setPropertyError = true;
                    throw e;
                }
                if (null === target) {
                    var e = MinimongoError("Cannot set property on null");
                    e.setPropertyError = true;
                    throw e;
                }
                target[field] = EJSON.clone(arg);
            },
            $setOnInsert: function() {},
            $unset: function(target, field) {
                void 0 !== target && (target instanceof Array ? field in target && (target[field] = null) : delete target[field]);
            },
            $push: function(target, field, arg) {
                void 0 === target[field] && (target[field] = []);
                if (!(target[field] instanceof Array)) throw MinimongoError("Cannot apply $push modifier to non-array");
                if (!(arg && arg.$each)) {
                    target[field].push(EJSON.clone(arg));
                    return;
                }
                var toPush = arg.$each;
                if (!(toPush instanceof Array)) throw MinimongoError("$each must be an array");
                var slice = void 0;
                if ("$slice" in arg) {
                    if ("number" != typeof arg.$slice) throw MinimongoError("$slice must be a numeric value");
                    if (arg.$slice > 0) throw MinimongoError("$slice in $push must be zero or negative");
                    slice = arg.$slice;
                }
                var sortFunction = void 0;
                if (arg.$sort) {
                    if (void 0 === slice) throw MinimongoError("$sort requires $slice to be present");
                    sortFunction = new Minimongo.Sorter(arg.$sort).getComparator();
                    for (var i = 0; toPush.length > i; i++) if (3 !== LocalCollection._f._type(toPush[i])) throw MinimongoError("$push like modifiers using $sort require all elements to be objects");
                }
                for (var j = 0; toPush.length > j; j++) target[field].push(EJSON.clone(toPush[j]));
                sortFunction && target[field].sort(sortFunction);
                void 0 !== slice && (target[field] = 0 === slice ? [] : target[field].slice(slice));
            },
            $pushAll: function(target, field, arg) {
                if (!("object" == typeof arg && arg instanceof Array)) throw MinimongoError("Modifier $pushAll/pullAll allowed for arrays only");
                var x = target[field];
                if (void 0 === x) target[field] = arg; else {
                    if (!(x instanceof Array)) throw MinimongoError("Cannot apply $pushAll modifier to non-array");
                    for (var i = 0; arg.length > i; i++) x.push(arg[i]);
                }
            },
            $addToSet: function(target, field, arg) {
                var x = target[field];
                if (void 0 === x) target[field] = [ arg ]; else {
                    if (!(x instanceof Array)) throw MinimongoError("Cannot apply $addToSet modifier to non-array");
                    var isEach = false;
                    if ("object" == typeof arg) for (var k in arg) {
                        "$each" === k && (isEach = true);
                        break;
                    }
                    var values = isEach ? arg["$each"] : [ arg ];
                    _.each(values, function(value) {
                        for (var i = 0; x.length > i; i++) if (LocalCollection._f._equal(value, x[i])) return;
                        x.push(EJSON.clone(value));
                    });
                }
            },
            $pop: function(target, field, arg) {
                if (void 0 === target) return;
                var x = target[field];
                if (void 0 === x) return;
                if (!(x instanceof Array)) throw MinimongoError("Cannot apply $pop modifier to non-array");
                "number" == typeof arg && 0 > arg ? x.splice(0, 1) : x.pop();
            },
            $pull: function(target, field, arg) {
                if (void 0 === target) return;
                var x = target[field];
                if (void 0 === x) return;
                if (!(x instanceof Array)) throw MinimongoError("Cannot apply $pull/pullAll modifier to non-array");
                var out = [];
                if ("object" != typeof arg || arg instanceof Array) for (var i = 0; x.length > i; i++) LocalCollection._f._equal(x[i], arg) || out.push(x[i]); else {
                    var matcher = new Minimongo.Matcher(arg);
                    for (var i = 0; x.length > i; i++) matcher.documentMatches(x[i]).result || out.push(x[i]);
                }
                target[field] = out;
            },
            $pullAll: function(target, field, arg) {
                if (!("object" == typeof arg && arg instanceof Array)) throw MinimongoError("Modifier $pushAll/pullAll allowed for arrays only");
                if (void 0 === target) return;
                var x = target[field];
                if (void 0 === x) return;
                if (!(x instanceof Array)) throw MinimongoError("Cannot apply $pull/pullAll modifier to non-array");
                var out = [];
                for (var i = 0; x.length > i; i++) {
                    var exclude = false;
                    for (var j = 0; arg.length > j; j++) if (LocalCollection._f._equal(x[i], arg[j])) {
                        exclude = true;
                        break;
                    }
                    exclude || out.push(x[i]);
                }
                target[field] = out;
            },
            $rename: function(target, field, arg, keypath, doc) {
                if (keypath === arg) throw MinimongoError("$rename source must differ from target");
                if (null === target) throw MinimongoError("$rename source field invalid");
                if ("string" != typeof arg) throw MinimongoError("$rename target must be a string");
                if (void 0 === target) return;
                var v = target[field];
                delete target[field];
                var keyparts = arg.split(".");
                var target2 = findModTarget(doc, keyparts, {
                    forbidArray: true
                });
                if (null === target2) throw MinimongoError("$rename target field invalid");
                var field2 = keyparts.pop();
                target2[field2] = v;
            },
            $bit: function() {
                throw MinimongoError("$bit is not supported");
            }
        };
    }).call(this);
    (function() {
        LocalCollection._diffQueryChanges = function(ordered, oldResults, newResults, observer) {
            ordered ? LocalCollection._diffQueryOrderedChanges(oldResults, newResults, observer) : LocalCollection._diffQueryUnorderedChanges(oldResults, newResults, observer);
        };
        LocalCollection._diffQueryUnorderedChanges = function(oldResults, newResults, observer) {
            if (observer.movedBefore) throw new Error("_diffQueryUnordered called with a movedBefore observer!");
            newResults.forEach(function(newDoc, id) {
                var oldDoc = oldResults.get(id);
                if (oldDoc) observer.changed && !EJSON.equals(oldDoc, newDoc) && observer.changed(id, LocalCollection._makeChangedFields(newDoc, oldDoc)); else if (observer.added) {
                    var fields = EJSON.clone(newDoc);
                    delete fields._id;
                    observer.added(newDoc._id, fields);
                }
            });
            observer.removed && oldResults.forEach(function(oldDoc, id) {
                newResults.has(id) || observer.removed(id);
            });
        };
        LocalCollection._diffQueryOrderedChanges = function(old_results, new_results, observer) {
            var new_presence_of_id = {};
            _.each(new_results, function(doc) {
                new_presence_of_id[doc._id] && Meteor._debug("Duplicate _id in new_results");
                new_presence_of_id[doc._id] = true;
            });
            var old_index_of_id = {};
            _.each(old_results, function(doc, i) {
                doc._id in old_index_of_id && Meteor._debug("Duplicate _id in old_results");
                old_index_of_id[doc._id] = i;
            });
            var unmoved = [];
            var max_seq_len = 0;
            var N = new_results.length;
            var seq_ends = new Array(N);
            var ptrs = new Array(N);
            var old_idx_seq = function(i_new) {
                return old_index_of_id[new_results[i_new]._id];
            };
            for (var i = 0; N > i; i++) if (void 0 !== old_index_of_id[new_results[i]._id]) {
                var j = max_seq_len;
                while (j > 0) {
                    if (old_idx_seq(seq_ends[j - 1]) < old_idx_seq(i)) break;
                    j--;
                }
                ptrs[i] = 0 === j ? -1 : seq_ends[j - 1];
                seq_ends[j] = i;
                j + 1 > max_seq_len && (max_seq_len = j + 1);
            }
            var idx = 0 === max_seq_len ? -1 : seq_ends[max_seq_len - 1];
            while (idx >= 0) {
                unmoved.push(idx);
                idx = ptrs[idx];
            }
            unmoved.reverse();
            unmoved.push(new_results.length);
            _.each(old_results, function(doc) {
                new_presence_of_id[doc._id] || observer.removed && observer.removed(doc._id);
            });
            var startOfGroup = 0;
            _.each(unmoved, function(endOfGroup) {
                var groupId = new_results[endOfGroup] ? new_results[endOfGroup]._id : null;
                var oldDoc;
                var newDoc;
                var fields;
                for (var i = startOfGroup; endOfGroup > i; i++) {
                    newDoc = new_results[i];
                    if (_.has(old_index_of_id, newDoc._id)) {
                        oldDoc = old_results[old_index_of_id[newDoc._id]];
                        fields = LocalCollection._makeChangedFields(newDoc, oldDoc);
                        _.isEmpty(fields) || observer.changed && observer.changed(newDoc._id, fields);
                        observer.movedBefore && observer.movedBefore(newDoc._id, groupId);
                    } else {
                        fields = EJSON.clone(newDoc);
                        delete fields._id;
                        observer.addedBefore && observer.addedBefore(newDoc._id, fields, groupId);
                        observer.added && observer.added(newDoc._id, fields);
                    }
                }
                if (groupId) {
                    newDoc = new_results[endOfGroup];
                    oldDoc = old_results[old_index_of_id[newDoc._id]];
                    fields = LocalCollection._makeChangedFields(newDoc, oldDoc);
                    _.isEmpty(fields) || observer.changed && observer.changed(newDoc._id, fields);
                }
                startOfGroup = endOfGroup + 1;
            });
        };
        LocalCollection._diffObjects = function(left, right, callbacks) {
            _.each(left, function(leftValue, key) {
                _.has(right, key) ? callbacks.both && callbacks.both(key, leftValue, right[key]) : callbacks.leftOnly && callbacks.leftOnly(key, leftValue);
            });
            callbacks.rightOnly && _.each(right, function(rightValue, key) {
                _.has(left, key) || callbacks.rightOnly(key, rightValue);
            });
        };
    }).call(this);
    (function() {
        LocalCollection._IdMap = function() {
            var self = this;
            IdMap.call(self, LocalCollection._idStringify, LocalCollection._idParse);
        };
        Meteor._inherits(LocalCollection._IdMap, IdMap);
    }).call(this);
    (function() {
        LocalCollection._CachingChangeObserver = function(options) {
            var self = this;
            options = options || {};
            var orderedFromCallbacks = options.callbacks && LocalCollection._observeChangesCallbacksAreOrdered(options.callbacks);
            if (_.has(options, "ordered")) {
                self.ordered = options.ordered;
                if (options.callbacks && options.ordered !== orderedFromCallbacks) throw Error("ordered option doesn't match callbacks");
            } else {
                if (!options.callbacks) throw Error("must provide ordered or callbacks");
                self.ordered = orderedFromCallbacks;
            }
            var callbacks = options.callbacks || {};
            if (self.ordered) {
                self.docs = new OrderedDict(LocalCollection._idStringify);
                self.applyChange = {
                    addedBefore: function(id, fields, before) {
                        var doc = EJSON.clone(fields);
                        doc._id = id;
                        callbacks.addedBefore && callbacks.addedBefore.call(self, id, fields, before);
                        callbacks.added && callbacks.added.call(self, id, fields);
                        self.docs.putBefore(id, doc, before || null);
                    },
                    movedBefore: function(id, before) {
                        self.docs.get(id);
                        callbacks.movedBefore && callbacks.movedBefore.call(self, id, before);
                        self.docs.moveBefore(id, before || null);
                    }
                };
            } else {
                self.docs = new LocalCollection._IdMap();
                self.applyChange = {
                    added: function(id, fields) {
                        var doc = EJSON.clone(fields);
                        callbacks.added && callbacks.added.call(self, id, fields);
                        doc._id = id;
                        self.docs.set(id, doc);
                    }
                };
            }
            self.applyChange.changed = function(id, fields) {
                var doc = self.docs.get(id);
                if (!doc) throw new Error("Unknown id for changed: " + id);
                callbacks.changed && callbacks.changed.call(self, id, EJSON.clone(fields));
                LocalCollection._applyChanges(doc, fields);
            };
            self.applyChange.removed = function(id) {
                callbacks.removed && callbacks.removed.call(self, id);
                self.docs.remove(id);
            };
        };
        LocalCollection._observeFromObserveChanges = function(cursor, observeCallbacks) {
            var transform = cursor.getTransform() || function(doc) {
                return doc;
            };
            var suppressed = !!observeCallbacks._suppress_initial;
            var observeChangesCallbacks;
            if (LocalCollection._observeCallbacksAreOrdered(observeCallbacks)) {
                var indices = !observeCallbacks._no_indices;
                observeChangesCallbacks = {
                    addedBefore: function(id, fields, before) {
                        var self = this;
                        if (suppressed || !(observeCallbacks.addedAt || observeCallbacks.added)) return;
                        var doc = transform(_.extend(fields, {
                            _id: id
                        }));
                        if (observeCallbacks.addedAt) {
                            var index = indices ? before ? self.docs.indexOf(before) : self.docs.size() : -1;
                            observeCallbacks.addedAt(doc, index, before);
                        } else observeCallbacks.added(doc);
                    },
                    changed: function(id, fields) {
                        var self = this;
                        if (!(observeCallbacks.changedAt || observeCallbacks.changed)) return;
                        var doc = EJSON.clone(self.docs.get(id));
                        if (!doc) throw new Error("Unknown id for changed: " + id);
                        var oldDoc = transform(EJSON.clone(doc));
                        LocalCollection._applyChanges(doc, fields);
                        doc = transform(doc);
                        if (observeCallbacks.changedAt) {
                            var index = indices ? self.docs.indexOf(id) : -1;
                            observeCallbacks.changedAt(doc, oldDoc, index);
                        } else observeCallbacks.changed(doc, oldDoc);
                    },
                    movedBefore: function(id, before) {
                        var self = this;
                        if (!observeCallbacks.movedTo) return;
                        var from = indices ? self.docs.indexOf(id) : -1;
                        var to = indices ? before ? self.docs.indexOf(before) : self.docs.size() : -1;
                        to > from && --to;
                        observeCallbacks.movedTo(transform(EJSON.clone(self.docs.get(id))), from, to, before || null);
                    },
                    removed: function(id) {
                        var self = this;
                        if (!(observeCallbacks.removedAt || observeCallbacks.removed)) return;
                        var doc = transform(self.docs.get(id));
                        if (observeCallbacks.removedAt) {
                            var index = indices ? self.docs.indexOf(id) : -1;
                            observeCallbacks.removedAt(doc, index);
                        } else observeCallbacks.removed(doc);
                    }
                };
            } else observeChangesCallbacks = {
                added: function(id, fields) {
                    if (!suppressed && observeCallbacks.added) {
                        var doc = _.extend(fields, {
                            _id: id
                        });
                        observeCallbacks.added(transform(doc));
                    }
                },
                changed: function(id, fields) {
                    var self = this;
                    if (observeCallbacks.changed) {
                        var oldDoc = self.docs.get(id);
                        var doc = EJSON.clone(oldDoc);
                        LocalCollection._applyChanges(doc, fields);
                        observeCallbacks.changed(transform(doc), transform(oldDoc));
                    }
                },
                removed: function(id) {
                    var self = this;
                    observeCallbacks.removed && observeCallbacks.removed(transform(self.docs.get(id)));
                }
            };
            var changeObserver = new LocalCollection._CachingChangeObserver({
                callbacks: observeChangesCallbacks
            });
            var handle = cursor.observeChanges(changeObserver.applyChange);
            suppressed = false;
            changeObserver.ordered && (handle._fetch = function() {
                var docsArray = [];
                changeObserver.docs.forEach(function(doc) {
                    docsArray.push(transform(EJSON.clone(doc)));
                });
                return docsArray;
            });
            return handle;
        };
    }).call(this);
    (function() {
        LocalCollection._looksLikeObjectID = function(str) {
            return 24 === str.length && str.match(/^[0-9a-f]*$/);
        };
        LocalCollection._ObjectID = function(hexString) {
            var self = this;
            if (hexString) {
                hexString = hexString.toLowerCase();
                if (!LocalCollection._looksLikeObjectID(hexString)) throw new Error("Invalid hexadecimal string for creating an ObjectID");
                self._str = hexString;
            } else self._str = Random.hexString(24);
        };
        LocalCollection._ObjectID.prototype.toString = function() {
            var self = this;
            return 'ObjectID("' + self._str + '")';
        };
        LocalCollection._ObjectID.prototype.equals = function(other) {
            var self = this;
            return other instanceof LocalCollection._ObjectID && self.valueOf() === other.valueOf();
        };
        LocalCollection._ObjectID.prototype.clone = function() {
            var self = this;
            return new LocalCollection._ObjectID(self._str);
        };
        LocalCollection._ObjectID.prototype.typeName = function() {
            return "oid";
        };
        LocalCollection._ObjectID.prototype.getTimestamp = function() {
            var self = this;
            return parseInt(self._str.substr(0, 8), 16);
        };
        LocalCollection._ObjectID.prototype.valueOf = LocalCollection._ObjectID.prototype.toJSONValue = LocalCollection._ObjectID.prototype.toHexString = function() {
            return this._str;
        };
        LocalCollection._selectorIsId = function(selector) {
            return "string" == typeof selector || "number" == typeof selector || selector instanceof LocalCollection._ObjectID;
        };
        LocalCollection._selectorIsIdPerhapsAsObject = function(selector) {
            return LocalCollection._selectorIsId(selector) || selector && "object" == typeof selector && selector._id && LocalCollection._selectorIsId(selector._id) && 1 === _.size(selector);
        };
        LocalCollection._idsMatchedBySelector = function(selector) {
            if (LocalCollection._selectorIsId(selector)) return [ selector ];
            if (!selector) return null;
            if (_.has(selector, "_id")) {
                if (LocalCollection._selectorIsId(selector._id)) return [ selector._id ];
                if (selector._id && selector._id.$in && _.isArray(selector._id.$in) && !_.isEmpty(selector._id.$in) && _.all(selector._id.$in, LocalCollection._selectorIsId)) return selector._id.$in;
                return null;
            }
            if (selector.$and && _.isArray(selector.$and)) for (var i = 0; selector.$and.length > i; ++i) {
                var subIds = LocalCollection._idsMatchedBySelector(selector.$and[i]);
                if (subIds) return subIds;
            }
            return null;
        };
    }).call(this);
    module.exports = {
        LocalCollection: LocalCollection,
        Minimongo: Minimongo
    };
})();