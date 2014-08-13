function randomToken() {
    return Random.hexString(20);
}

var WebSocket = require("net.iamyellow.tiws");

var Deps = Package.deps.Deps;

var EJSON = Package.ejson.EJSON;

var LocalCollection = Package.minimongo.LocalCollection;

var Minimongo = Package.minimongo.Minimongo;

LivedataTest = {}, DDP = {};

SUPPORTED_DDP_VERSIONS = [ "pre2", "pre1" ];

LivedataTest.SUPPORTED_DDP_VERSIONS = SUPPORTED_DDP_VERSIONS;

MethodInvocation = function(options) {
    this.isSimulation = options.isSimulation;
    this._unblock = options.unblock || function() {};
    this._calledUnblock = false;
    this.userId = options.userId;
    this._setUserId = options.setUserId || function() {};
    this.connection = options.connection;
    this.randomSeed = options.randomSeed;
    this.randomStream = null;
};

_.extend(MethodInvocation.prototype, {
    unblock: function() {
        var self = this;
        self._calledUnblock = true;
        self._unblock();
    },
    setUserId: function(userId) {
        var self = this;
        if (self._calledUnblock) throw new Error("Can't call setUserId in a method after calling unblock");
        self.userId = userId;
        self._setUserId(userId);
    }
});

parseDDP = function(stringMessage) {
    try {
        var msg = JSON.parse(stringMessage);
    } catch (e) {
        Meteor._debug("Discarding message with invalid JSON", stringMessage);
        return null;
    }
    if (null === msg || "object" != typeof msg) {
        Meteor._debug("Discarding non-object DDP message", stringMessage);
        return null;
    }
    if (_.has(msg, "cleared")) {
        _.has(msg, "fields") || (msg.fields = {});
        _.each(msg.cleared, function(clearKey) {
            msg.fields[clearKey] = void 0;
        });
        delete msg.cleared;
    }
    _.each([ "fields", "params", "result" ], function(field) {
        _.has(msg, field) && (msg[field] = EJSON._adjustTypesFromJSONValue(msg[field]));
    });
    return msg;
};

stringifyDDP = function(msg) {
    var copy = EJSON.clone(msg);
    if (_.has(msg, "fields")) {
        var cleared = [];
        _.each(msg.fields, function(value, key) {
            if (void 0 === value) {
                cleared.push(key);
                delete copy.fields[key];
            }
        });
        _.isEmpty(cleared) || (copy.cleared = cleared);
        _.isEmpty(copy.fields) && delete copy.fields;
    }
    _.each([ "fields", "params", "result" ], function(field) {
        _.has(copy, field) && (copy[field] = EJSON._adjustTypesToJSONValue(copy[field]));
    });
    if (msg.id && "string" != typeof msg.id) throw new Error("Message id is not a string");
    return JSON.stringify(copy);
};

DDP._CurrentInvocation = new Meteor.EnvironmentVariable();

Heartbeat = function(options) {
    var self = this;
    self.heartbeatInterval = options.heartbeatInterval;
    self.heartbeatTimeout = options.heartbeatTimeout;
    self._sendPing = options.sendPing;
    self._onTimeout = options.onTimeout;
    self._heartbeatIntervalHandle = null;
    self._heartbeatTimeoutHandle = null;
};

_.extend(Heartbeat.prototype, {
    stop: function() {
        var self = this;
        self._clearHeartbeatIntervalTimer();
        self._clearHeartbeatTimeoutTimer();
    },
    start: function() {
        var self = this;
        self.stop();
        self._startHeartbeatIntervalTimer();
    },
    _startHeartbeatIntervalTimer: function() {
        var self = this;
        self._heartbeatIntervalHandle = Meteor.setTimeout(_.bind(self._heartbeatIntervalFired, self), self.heartbeatInterval);
    },
    _startHeartbeatTimeoutTimer: function() {
        var self = this;
        self._heartbeatTimeoutHandle = Meteor.setTimeout(_.bind(self._heartbeatTimeoutFired, self), self.heartbeatTimeout);
    },
    _clearHeartbeatIntervalTimer: function() {
        var self = this;
        if (self._heartbeatIntervalHandle) {
            Meteor.clearTimeout(self._heartbeatIntervalHandle);
            self._heartbeatIntervalHandle = null;
        }
    },
    _clearHeartbeatTimeoutTimer: function() {
        var self = this;
        if (self._heartbeatTimeoutHandle) {
            Meteor.clearTimeout(self._heartbeatTimeoutHandle);
            self._heartbeatTimeoutHandle = null;
        }
    },
    _heartbeatIntervalFired: function() {
        var self = this;
        self._heartbeatIntervalHandle = null;
        self._sendPing();
        self._startHeartbeatTimeoutTimer();
    },
    _heartbeatTimeoutFired: function() {
        var self = this;
        self._heartbeatTimeoutHandle = null;
        self._onTimeout();
    },
    pingReceived: function() {
        var self = this;
        if (self._heartbeatIntervalHandle) {
            self._clearHeartbeatIntervalTimer();
            self._startHeartbeatIntervalTimer();
        }
    },
    pongReceived: function() {
        var self = this;
        if (self._heartbeatTimeoutHandle) {
            self._clearHeartbeatTimeoutTimer();
            self._startHeartbeatIntervalTimer();
        }
    }
});

LivedataTest.ClientStream = function(url, options) {
    var self = this;
    self.options = _.extend({
        retry: true
    }, options);
    self._initCommon();
    self.HEARTBEAT_TIMEOUT = 1e5;
    self.rawUrl = url;
    self.socket = null;
    self.heartbeatTimer = null;
    self._launchConnection();
};

_.extend(LivedataTest.ClientStream.prototype, {
    send: function(data) {
        var self = this;
        self.currentStatus.connected && self.socket.send(data);
    },
    _changeUrl: function(url) {
        var self = this;
        self.rawUrl = url;
    },
    _connected: function() {
        var self = this;
        if (self.connectionTimer) {
            clearTimeout(self.connectionTimer);
            self.connectionTimer = null;
        }
        if (self.currentStatus.connected) return;
        self.currentStatus.status = "connected";
        self.currentStatus.connected = true;
        self.currentStatus.retryCount = 0;
        self.statusChanged();
        _.each(self.eventCallbacks.reset, function(callback) {
            callback();
        });
    },
    _cleanup: function() {
        var self = this;
        self._clearConnectionAndHeartbeatTimers();
        if (self.socket) {
            self.socket.onmessage = self.socket.onclose = self.socket.onerror = self.socket.onheartbeat = function() {};
            self.socket.close();
            self.socket = null;
        }
        _.each(self.eventCallbacks.disconnect, function(callback) {
            callback();
        });
    },
    _clearConnectionAndHeartbeatTimers: function() {
        var self = this;
        if (self.connectionTimer) {
            clearTimeout(self.connectionTimer);
            self.connectionTimer = null;
        }
        if (self.heartbeatTimer) {
            clearTimeout(self.heartbeatTimer);
            self.heartbeatTimer = null;
        }
    },
    _heartbeat_timeout: function() {
        var self = this;
        Meteor._debug("Connection timeout. No sockjs heartbeat received.");
        self._lostConnection();
    },
    _heartbeat_received: function() {
        var self = this;
        if (self._forcedToDisconnect) return;
        self.heartbeatTimer && clearTimeout(self.heartbeatTimer);
        self.heartbeatTimer = setTimeout(_.bind(self._heartbeat_timeout, self), self.HEARTBEAT_TIMEOUT);
    },
    _launchConnection: function() {
        var self = this;
        self._cleanup();
        self.socket = WebSocket.createWS();
        var url = {
            protocol: self.rawUrl.use_ssl ? "wss://" : "ws://",
            host: self.rawUrl.host,
            port: self.rawUrl.port
        };
        self.socket.open(url.protocol + url.host + ":" + url.port + "/" + "websocket");
        self.socket.addEventListener("open", function() {
            self._connected();
        });
        self.socket.addEventListener("message", function(data) {
            self._heartbeat_received();
            self.currentStatus.connected && _.each(self.eventCallbacks.message, function(callback) {
                callback(data.data);
            });
        });
        self.socket.addEventListener("error", function(error) {
            console.log("socket error: " + JSON.stringify(error));
        });
        self.socket.addEventListener("close", function() {
            console.log("socket close");
            self._lostConnection();
        });
        self.connectionTimer && clearTimeout(self.connectionTimer);
        self.connectionTimer = setTimeout(_.bind(self._lostConnection, self), self.CONNECT_TIMEOUT);
    }
});

var Connection = function(url, options) {
    var self = this;
    options = _.extend({
        onConnected: function() {},
        onDDPVersionNegotiationFailure: function(description) {
            Meteor._debug(description);
        },
        heartbeatInterval: 35e3,
        heartbeatTimeout: 15e3,
        reloadWithOutstanding: false,
        supportedDDPVersions: SUPPORTED_DDP_VERSIONS,
        retry: true,
        respondToPings: true
    }, options);
    self.onReconnect = null;
    self._stream = new LivedataTest.ClientStream(url, {
        retry: options.retry,
        headers: options.headers,
        _sockjsOptions: options._sockjsOptions,
        _dontPrintErrors: options._dontPrintErrors
    });
    self._lastSessionId = null;
    self._versionSuggestion = null;
    self._version = null;
    self._stores = {};
    self._methodHandlers = {};
    self._nextMethodId = 1;
    self._supportedDDPVersions = options.supportedDDPVersions;
    self._heartbeatInterval = options.heartbeatInterval;
    self._heartbeatTimeout = options.heartbeatTimeout;
    self._methodInvokers = {};
    self._outstandingMethodBlocks = [];
    self._documentsWrittenByStub = {};
    self._serverDocuments = {};
    self._afterUpdateCallbacks = [];
    self._messagesBufferedUntilQuiescence = [];
    self._methodsBlockingQuiescence = {};
    self._subsBeingRevived = {};
    self._resetStores = false;
    self._updatesForUnknownStores = {};
    self._retryMigrate = null;
    self._subscriptions = {};
    self._userId = null;
    self._userIdDeps = new Deps.Dependency();
    Meteor.isClient && Package.reload && !options.reloadWithOutstanding && Package.reload.Reload._onMigrate(function(retry) {
        if (self._readyToMigrate()) return [ true ];
        if (self._retryMigrate) throw new Error("Two migrations in progress?");
        self._retryMigrate = retry;
        return false;
    });
    var onMessage = function(raw_msg) {
        try {
            var msg = parseDDP(raw_msg);
        } catch (e) {
            Meteor._debug("Exception while parsing DDP", e);
            return;
        }
        if (null === msg || !msg.msg) {
            msg && msg.server_id || Meteor._debug("discarding invalid livedata message", msg);
            return;
        }
        if ("connected" === msg.msg) {
            self._version = self._versionSuggestion;
            self._livedata_connected(msg);
            options.onConnected();
        } else if ("failed" == msg.msg) if (_.contains(self._supportedDDPVersions, msg.version)) {
            self._versionSuggestion = msg.version;
            self._stream.reconnect({
                _force: true
            });
        } else {
            var description = "DDP version negotiation failed; server requested version " + msg.version;
            self._stream.disconnect({
                _permanent: true,
                _error: description
            });
            options.onDDPVersionNegotiationFailure(description);
        } else if ("ping" === msg.msg) {
            options.respondToPings && self._send({
                msg: "pong",
                id: msg.id
            });
            self._heartbeat && self._heartbeat.pingReceived();
        } else "pong" === msg.msg ? self._heartbeat && self._heartbeat.pongReceived() : _.include([ "added", "changed", "removed", "ready", "updated" ], msg.msg) ? self._livedata_data(msg) : "nosub" === msg.msg ? self._livedata_nosub(msg) : "result" === msg.msg ? self._livedata_result(msg) : "error" === msg.msg ? self._livedata_error(msg) : Meteor._debug("discarding unknown livedata message type", msg);
    };
    var onReset = function() {
        var msg = {
            msg: "connect"
        };
        self._lastSessionId && (msg.session = self._lastSessionId);
        msg.version = self._versionSuggestion || self._supportedDDPVersions[0];
        self._versionSuggestion = msg.version;
        msg.support = self._supportedDDPVersions;
        self._send(msg);
        !_.isEmpty(self._outstandingMethodBlocks) && _.isEmpty(self._outstandingMethodBlocks[0].methods) && self._outstandingMethodBlocks.shift();
        _.each(self._methodInvokers, function(m) {
            m.sentMessage = false;
        });
        self.onReconnect ? self._callOnReconnectAndSendAppropriateOutstandingMethods() : self._sendOutstandingMethods();
        _.each(self._subscriptions, function(sub, id) {
            self._send({
                msg: "sub",
                id: id,
                name: sub.name,
                params: sub.params
            });
        });
    };
    var onDisconnect = function() {
        if (self._heartbeat) {
            self._heartbeat.stop();
            self._heartbeat = null;
        }
    };
    self._stream.on("message", onMessage);
    self._stream.on("reset", onReset);
    self._stream.on("disconnect", onDisconnect);
};

var MethodInvoker = function(options) {
    var self = this;
    self.methodId = options.methodId;
    self.sentMessage = false;
    self._callback = options.callback;
    self._connection = options.connection;
    self._message = options.message;
    self._onResultReceived = options.onResultReceived || function() {};
    self._wait = options.wait;
    self._methodResult = null;
    self._dataVisible = false;
    self._connection._methodInvokers[self.methodId] = self;
};

_.extend(MethodInvoker.prototype, {
    sendMessage: function() {
        var self = this;
        if (self.gotResult()) throw new Error("sendingMethod is called on method with result");
        self._dataVisible = false;
        self.sentMessage = true;
        self._wait && (self._connection._methodsBlockingQuiescence[self.methodId] = true);
        self._connection._send(self._message);
    },
    _maybeInvokeCallback: function() {
        var self = this;
        if (self._methodResult && self._dataVisible) {
            self._callback(self._methodResult[0], self._methodResult[1]);
            delete self._connection._methodInvokers[self.methodId];
            self._connection._outstandingMethodFinished();
        }
    },
    receiveResult: function(err, result) {
        var self = this;
        if (self.gotResult()) throw new Error("Methods should only receive results once");
        self._methodResult = [ err, result ];
        self._onResultReceived(err, result);
        self._maybeInvokeCallback();
    },
    dataVisible: function() {
        var self = this;
        self._dataVisible = true;
        self._maybeInvokeCallback();
    },
    gotResult: function() {
        var self = this;
        return !!self._methodResult;
    }
});

_.extend(Connection.prototype, {
    registerStore: function(name, wrappedStore) {
        var self = this;
        if (name in self._stores) return false;
        var store = {};
        _.each([ "update", "beginUpdate", "endUpdate", "saveOriginals", "retrieveOriginals" ], function(method) {
            store[method] = function() {
                return wrappedStore[method] ? wrappedStore[method].apply(wrappedStore, arguments) : void 0;
            };
        });
        self._stores[name] = store;
        var queued = self._updatesForUnknownStores[name];
        if (queued) {
            store.beginUpdate(queued.length, false);
            _.each(queued, function(msg) {
                store.update(msg);
            });
            store.endUpdate();
            delete self._updatesForUnknownStores[name];
        }
        return true;
    },
    subscribe: function(name) {
        var self = this;
        var params = Array.prototype.slice.call(arguments, 1);
        var callbacks = {};
        if (params.length) {
            var lastParam = params[params.length - 1];
            "function" == typeof lastParam ? callbacks.onReady = params.pop() : !lastParam || "function" != typeof lastParam.onReady && "function" != typeof lastParam.onError || (callbacks = params.pop());
        }
        var existing = _.find(self._subscriptions, function(sub) {
            return sub.inactive && sub.name === name && EJSON.equals(sub.params, params);
        });
        var id;
        if (existing) {
            id = existing.id;
            existing.inactive = false;
            callbacks.onReady && (existing.ready || (existing.readyCallback = callbacks.onReady));
            callbacks.onError && (existing.errorCallback = callbacks.onError);
        } else {
            id = Random.id();
            self._subscriptions[id] = {
                id: id,
                name: name,
                params: EJSON.clone(params),
                inactive: false,
                ready: false,
                readyDeps: new Deps.Dependency(),
                readyCallback: callbacks.onReady,
                errorCallback: callbacks.onError,
                connection: self,
                remove: function() {
                    delete this.connection._subscriptions[this.id];
                    this.ready && this.readyDeps.changed();
                },
                stop: function() {
                    this.connection._send({
                        msg: "unsub",
                        id: id
                    });
                    this.remove();
                }
            };
            self._send({
                msg: "sub",
                id: id,
                name: name,
                params: params
            });
        }
        var handle = {
            stop: function() {
                if (!_.has(self._subscriptions, id)) return;
                self._subscriptions[id].stop();
            },
            ready: function() {
                if (!_.has(self._subscriptions, id)) return false;
                var record = self._subscriptions[id];
                record.readyDeps.depend();
                return record.ready;
            }
        };
        Deps.active && Deps.onInvalidate(function() {
            _.has(self._subscriptions, id) && (self._subscriptions[id].inactive = true);
            Deps.afterFlush(function() {
                _.has(self._subscriptions, id) && self._subscriptions[id].inactive && handle.stop();
            });
        });
        return handle;
    },
    _subscribeAndWait: function(name, args, options) {
        var self = this;
        var f = new Future();
        var ready = false;
        var handle;
        args = args || [];
        args.push({
            onReady: function() {
                ready = true;
                f["return"]();
            },
            onError: function(e) {
                ready ? options && options.onLateError && options.onLateError(e) : f["throw"](e);
            }
        });
        handle = self.subscribe.apply(self, [ name ].concat(args));
        f.wait();
        return handle;
    },
    methods: function(methods) {
        var self = this;
        _.each(methods, function(func, name) {
            if (self._methodHandlers[name]) throw new Error("A method named '" + name + "' is already defined");
            self._methodHandlers[name] = func;
        });
    },
    call: function(name) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (args.length && "function" == typeof args[args.length - 1]) var callback = args.pop();
        return this.apply(name, args, callback);
    },
    apply: function(name, args, options, callback) {
        var self = this;
        if (!callback && "function" == typeof options) {
            callback = options;
            options = {};
        }
        options = options || {};
        callback && (callback = Meteor.bindEnvironment(callback, "delivering result of invoking '" + name + "'"));
        args = EJSON.clone(args);
        var methodId = function() {
            var id;
            return function() {
                void 0 === id && (id = "" + self._nextMethodId++);
                return id;
            };
        }();
        var enclosing = DDP._CurrentInvocation.get();
        var alreadyInSimulation = enclosing && enclosing.isSimulation;
        var randomSeed = null;
        var randomSeedGenerator = function() {
            null === randomSeed && (randomSeed = makeRpcSeed(enclosing, name));
            return randomSeed;
        };
        var stub = self._methodHandlers[name];
        if (stub) {
            var setUserId = function(userId) {
                self.setUserId(userId);
            };
            var invocation = new MethodInvocation({
                isSimulation: true,
                userId: self.userId(),
                setUserId: setUserId,
                randomSeed: function() {
                    return randomSeedGenerator();
                }
            });
            alreadyInSimulation || self._saveOriginals();
            try {
                var stubReturnValue = DDP._CurrentInvocation.withValue(invocation, function() {
                    return stub.apply(invocation, EJSON.clone(args));
                });
            } catch (e) {
                var exception = e;
            }
            alreadyInSimulation || self._retrieveAndStoreOriginals(methodId());
        }
        if (alreadyInSimulation) {
            if (callback) {
                callback(exception, stubReturnValue);
                return void 0;
            }
            if (exception) throw exception;
            return stubReturnValue;
        }
        exception && !exception.expected && Meteor._debug("Exception while simulating the effect of invoking '" + name + "'", exception, exception.stack);
        if (!callback) if (Meteor.isClient) callback = function(err) {
            err && Meteor._debug("Error invoking Method '" + name + "':", err.message);
        }; else {
            var future = new Future();
            callback = future.resolver();
        }
        var message = {
            msg: "method",
            method: name,
            params: args,
            id: methodId()
        };
        null !== randomSeed && (message.randomSeed = randomSeed);
        var methodInvoker = new MethodInvoker({
            methodId: methodId(),
            callback: callback,
            connection: self,
            onResultReceived: options.onResultReceived,
            wait: !!options.wait,
            message: message
        });
        if (options.wait) self._outstandingMethodBlocks.push({
            wait: true,
            methods: [ methodInvoker ]
        }); else {
            (_.isEmpty(self._outstandingMethodBlocks) || _.last(self._outstandingMethodBlocks).wait) && self._outstandingMethodBlocks.push({
                wait: false,
                methods: []
            });
            _.last(self._outstandingMethodBlocks).methods.push(methodInvoker);
        }
        1 === self._outstandingMethodBlocks.length && methodInvoker.sendMessage();
        if (future) return future.wait();
        return options.returnStubValue ? stubReturnValue : void 0;
    },
    _saveOriginals: function() {
        var self = this;
        _.each(self._stores, function(s) {
            s.saveOriginals();
        });
    },
    _retrieveAndStoreOriginals: function(methodId) {
        var self = this;
        if (self._documentsWrittenByStub[methodId]) throw new Error("Duplicate methodId in _retrieveAndStoreOriginals");
        var docsWritten = [];
        _.each(self._stores, function(s, collection) {
            var originals = s.retrieveOriginals();
            if (!originals) return;
            originals.forEach(function(doc, id) {
                docsWritten.push({
                    collection: collection,
                    id: id
                });
                _.has(self._serverDocuments, collection) || (self._serverDocuments[collection] = new LocalCollection._IdMap());
                var serverDoc = self._serverDocuments[collection].setDefault(id, {});
                if (serverDoc.writtenByStubs) serverDoc.writtenByStubs[methodId] = true; else {
                    serverDoc.document = doc;
                    serverDoc.flushCallbacks = [];
                    serverDoc.writtenByStubs = {};
                    serverDoc.writtenByStubs[methodId] = true;
                }
            });
        });
        _.isEmpty(docsWritten) || (self._documentsWrittenByStub[methodId] = docsWritten);
    },
    _unsubscribeAll: function() {
        var self = this;
        _.each(_.clone(self._subscriptions), function(sub, id) {
            "meteor_autoupdate_clientVersions" !== sub.name && self._subscriptions[id].stop();
        });
    },
    _send: function(obj) {
        var self = this;
        self._stream.send(stringifyDDP(obj));
    },
    _lostConnection: function() {
        var self = this;
        self._stream._lostConnection();
    },
    status: function() {
        var self = this;
        return self._stream.status.apply(self._stream, arguments);
    },
    reconnect: function() {
        var self = this;
        return self._stream.reconnect.apply(self._stream, arguments);
    },
    disconnect: function() {
        var self = this;
        return self._stream.disconnect.apply(self._stream, arguments);
    },
    close: function() {
        var self = this;
        return self._stream.disconnect({
            _permanent: true
        });
    },
    userId: function() {
        var self = this;
        self._userIdDeps && self._userIdDeps.depend();
        return self._userId;
    },
    setUserId: function(userId) {
        var self = this;
        if (self._userId === userId) return;
        self._userId = userId;
        self._userIdDeps && self._userIdDeps.changed();
    },
    _waitingForQuiescence: function() {
        var self = this;
        return !_.isEmpty(self._subsBeingRevived) || !_.isEmpty(self._methodsBlockingQuiescence);
    },
    _anyMethodsAreOutstanding: function() {
        var self = this;
        return _.any(_.pluck(self._methodInvokers, "sentMessage"));
    },
    _livedata_connected: function(msg) {
        var self = this;
        if ("pre1" !== self._version && 0 !== self._heartbeatInterval) {
            self._heartbeat = new Heartbeat({
                heartbeatInterval: self._heartbeatInterval,
                heartbeatTimeout: self._heartbeatTimeout,
                onTimeout: function() {
                    Meteor.isClient && !self._stream._isStub && Meteor._debug("Connection timeout. No DDP heartbeat received.");
                    self._lostConnection();
                },
                sendPing: function() {
                    self._send({
                        msg: "ping"
                    });
                }
            });
            self._heartbeat.start();
        }
        self._lastSessionId && (self._resetStores = true);
        if ("string" == typeof msg.session) {
            var reconnectedToPreviousSession = self._lastSessionId === msg.session;
            self._lastSessionId = msg.session;
        }
        if (reconnectedToPreviousSession) return;
        self._updatesForUnknownStores = {};
        if (self._resetStores) {
            self._documentsWrittenByStub = {};
            self._serverDocuments = {};
        }
        self._afterUpdateCallbacks = [];
        self._subsBeingRevived = {};
        _.each(self._subscriptions, function(sub, id) {
            sub.ready && (self._subsBeingRevived[id] = true);
        });
        self._methodsBlockingQuiescence = {};
        self._resetStores && _.each(self._methodInvokers, function(invoker) {
            invoker.gotResult() ? self._afterUpdateCallbacks.push(_.bind(invoker.dataVisible, invoker)) : invoker.sentMessage && (self._methodsBlockingQuiescence[invoker.methodId] = true);
        });
        self._messagesBufferedUntilQuiescence = [];
        if (!self._waitingForQuiescence()) {
            if (self._resetStores) {
                _.each(self._stores, function(s) {
                    s.beginUpdate(0, true);
                    s.endUpdate();
                });
                self._resetStores = false;
            }
            self._runAfterUpdateCallbacks();
        }
    },
    _processOneDataMessage: function(msg, updates) {
        var self = this;
        self["_process_" + msg.msg](msg, updates);
    },
    _livedata_data: function(msg) {
        var self = this;
        var updates = {};
        if (self._waitingForQuiescence()) {
            self._messagesBufferedUntilQuiescence.push(msg);
            "nosub" === msg.msg && delete self._subsBeingRevived[msg.id];
            _.each(msg.subs || [], function(subId) {
                delete self._subsBeingRevived[subId];
            });
            _.each(msg.methods || [], function(methodId) {
                delete self._methodsBlockingQuiescence[methodId];
            });
            if (self._waitingForQuiescence()) return;
            _.each(self._messagesBufferedUntilQuiescence, function(bufferedMsg) {
                self._processOneDataMessage(bufferedMsg, updates);
            });
            self._messagesBufferedUntilQuiescence = [];
        } else self._processOneDataMessage(msg, updates);
        if (self._resetStores || !_.isEmpty(updates)) {
            _.each(self._stores, function(s, storeName) {
                s.beginUpdate(_.has(updates, storeName) ? updates[storeName].length : 0, self._resetStores);
            });
            self._resetStores = false;
            _.each(updates, function(updateMessages, storeName) {
                var store = self._stores[storeName];
                if (store) _.each(updateMessages, function(updateMessage) {
                    store.update(updateMessage);
                }); else {
                    _.has(self._updatesForUnknownStores, storeName) || (self._updatesForUnknownStores[storeName] = []);
                    Array.prototype.push.apply(self._updatesForUnknownStores[storeName], updateMessages);
                }
            });
            _.each(self._stores, function(s) {
                s.endUpdate();
            });
        }
        self._runAfterUpdateCallbacks();
    },
    _runAfterUpdateCallbacks: function() {
        var self = this;
        var callbacks = self._afterUpdateCallbacks;
        self._afterUpdateCallbacks = [];
        _.each(callbacks, function(c) {
            c();
        });
    },
    _pushUpdate: function(updates, collection, msg) {
        _.has(updates, collection) || (updates[collection] = []);
        updates[collection].push(msg);
    },
    _getServerDoc: function(collection, id) {
        var self = this;
        if (!_.has(self._serverDocuments, collection)) return null;
        var serverDocsForCollection = self._serverDocuments[collection];
        return serverDocsForCollection.get(id) || null;
    },
    _process_added: function(msg, updates) {
        var self = this;
        var id = LocalCollection._idParse(msg.id);
        var serverDoc = self._getServerDoc(msg.collection, id);
        if (serverDoc) {
            if (void 0 !== serverDoc.document) throw new Error("Server sent add for existing id: " + msg.id);
            serverDoc.document = msg.fields || {};
            serverDoc.document._id = id;
        } else self._pushUpdate(updates, msg.collection, msg);
    },
    _process_changed: function(msg, updates) {
        var self = this;
        var serverDoc = self._getServerDoc(msg.collection, LocalCollection._idParse(msg.id));
        if (serverDoc) {
            if (void 0 === serverDoc.document) throw new Error("Server sent changed for nonexisting id: " + msg.id);
            LocalCollection._applyChanges(serverDoc.document, msg.fields);
        } else self._pushUpdate(updates, msg.collection, msg);
    },
    _process_removed: function(msg, updates) {
        var self = this;
        var serverDoc = self._getServerDoc(msg.collection, LocalCollection._idParse(msg.id));
        if (serverDoc) {
            if (void 0 === serverDoc.document) throw new Error("Server sent removed for nonexisting id:" + msg.id);
            serverDoc.document = void 0;
        } else self._pushUpdate(updates, msg.collection, {
            msg: "removed",
            collection: msg.collection,
            id: msg.id
        });
    },
    _process_updated: function(msg, updates) {
        var self = this;
        _.each(msg.methods, function(methodId) {
            _.each(self._documentsWrittenByStub[methodId], function(written) {
                var serverDoc = self._getServerDoc(written.collection, written.id);
                if (!serverDoc) throw new Error("Lost serverDoc for " + JSON.stringify(written));
                if (!serverDoc.writtenByStubs[methodId]) throw new Error("Doc " + JSON.stringify(written) + " not written by  method " + methodId);
                delete serverDoc.writtenByStubs[methodId];
                if (_.isEmpty(serverDoc.writtenByStubs)) {
                    self._pushUpdate(updates, written.collection, {
                        msg: "replace",
                        id: LocalCollection._idStringify(written.id),
                        replace: serverDoc.document
                    });
                    _.each(serverDoc.flushCallbacks, function(c) {
                        c();
                    });
                    self._serverDocuments[written.collection].remove(written.id);
                }
            });
            delete self._documentsWrittenByStub[methodId];
            var callbackInvoker = self._methodInvokers[methodId];
            if (!callbackInvoker) throw new Error("No callback invoker for method " + methodId);
            self._runWhenAllServerDocsAreFlushed(_.bind(callbackInvoker.dataVisible, callbackInvoker));
        });
    },
    _process_ready: function(msg) {
        var self = this;
        _.each(msg.subs, function(subId) {
            self._runWhenAllServerDocsAreFlushed(function() {
                var subRecord = self._subscriptions[subId];
                if (!subRecord) return;
                if (subRecord.ready) return;
                subRecord.readyCallback && subRecord.readyCallback();
                subRecord.ready = true;
                subRecord.readyDeps.changed();
            });
        });
    },
    _runWhenAllServerDocsAreFlushed: function(f) {
        var self = this;
        var runFAfterUpdates = function() {
            self._afterUpdateCallbacks.push(f);
        };
        var unflushedServerDocCount = 0;
        var onServerDocFlush = function() {
            --unflushedServerDocCount;
            0 === unflushedServerDocCount && runFAfterUpdates();
        };
        _.each(self._serverDocuments, function(collectionDocs) {
            collectionDocs.forEach(function(serverDoc) {
                var writtenByStubForAMethodWithSentMessage = _.any(serverDoc.writtenByStubs, function(dummy, methodId) {
                    var invoker = self._methodInvokers[methodId];
                    return invoker && invoker.sentMessage;
                });
                if (writtenByStubForAMethodWithSentMessage) {
                    ++unflushedServerDocCount;
                    serverDoc.flushCallbacks.push(onServerDocFlush);
                }
            });
        });
        0 === unflushedServerDocCount && runFAfterUpdates();
    },
    _livedata_nosub: function(msg) {
        var self = this;
        self._livedata_data(msg);
        if (!_.has(self._subscriptions, msg.id)) return;
        var errorCallback = self._subscriptions[msg.id].errorCallback;
        self._subscriptions[msg.id].remove();
        errorCallback && msg.error && errorCallback(new Meteor.Error(msg.error.error, msg.error.reason, msg.error.details));
    },
    _process_nosub: function() {},
    _livedata_result: function(msg) {
        var self = this;
        if (_.isEmpty(self._outstandingMethodBlocks)) {
            Meteor._debug("Received method result but no methods outstanding");
            return;
        }
        var currentMethodBlock = self._outstandingMethodBlocks[0].methods;
        var m;
        for (var i = 0; currentMethodBlock.length > i; i++) {
            m = currentMethodBlock[i];
            if (m.methodId === msg.id) break;
        }
        if (!m) {
            Meteor._debug("Can't match method response to original method call", msg);
            return;
        }
        currentMethodBlock.splice(i, 1);
        _.has(msg, "error") ? m.receiveResult(new Meteor.Error(msg.error.error, msg.error.reason, msg.error.details)) : m.receiveResult(void 0, msg.result);
    },
    _outstandingMethodFinished: function() {
        var self = this;
        if (self._anyMethodsAreOutstanding()) return;
        if (!_.isEmpty(self._outstandingMethodBlocks)) {
            var firstBlock = self._outstandingMethodBlocks.shift();
            if (!_.isEmpty(firstBlock.methods)) throw new Error("No methods outstanding but nonempty block: " + JSON.stringify(firstBlock));
            _.isEmpty(self._outstandingMethodBlocks) || self._sendOutstandingMethods();
        }
        self._maybeMigrate();
    },
    _sendOutstandingMethods: function() {
        var self = this;
        if (_.isEmpty(self._outstandingMethodBlocks)) return;
        _.each(self._outstandingMethodBlocks[0].methods, function(m) {
            m.sendMessage();
        });
    },
    _livedata_error: function(msg) {
        Meteor._debug("Received error from server: ", msg.reason);
        msg.offendingMessage && Meteor._debug("For: ", msg.offendingMessage);
    },
    _callOnReconnectAndSendAppropriateOutstandingMethods: function() {
        var self = this;
        var oldOutstandingMethodBlocks = self._outstandingMethodBlocks;
        self._outstandingMethodBlocks = [];
        self.onReconnect();
        if (_.isEmpty(oldOutstandingMethodBlocks)) return;
        if (_.isEmpty(self._outstandingMethodBlocks)) {
            self._outstandingMethodBlocks = oldOutstandingMethodBlocks;
            self._sendOutstandingMethods();
            return;
        }
        if (!_.last(self._outstandingMethodBlocks).wait && !oldOutstandingMethodBlocks[0].wait) {
            _.each(oldOutstandingMethodBlocks[0].methods, function(m) {
                _.last(self._outstandingMethodBlocks).methods.push(m);
                1 === self._outstandingMethodBlocks.length && m.sendMessage();
            });
            oldOutstandingMethodBlocks.shift();
        }
        _.each(oldOutstandingMethodBlocks, function(block) {
            self._outstandingMethodBlocks.push(block);
        });
    },
    _readyToMigrate: function() {
        var self = this;
        return _.isEmpty(self._methodInvokers);
    },
    _maybeMigrate: function() {
        var self = this;
        if (self._retryMigrate && self._readyToMigrate()) {
            self._retryMigrate();
            self._retryMigrate = null;
        }
    }
});

DDP.connect = function(url, options) {
    var ret = new Connection(url, options);
    allConnections.push(ret);
    return ret;
};

allConnections = [];

DDP._allSubscriptionsReady = function() {
    return _.all(allConnections, function(conn) {
        return _.all(conn._subscriptions, function(sub) {
            return sub.ready;
        });
    });
};

var startsWith = function(str, starts) {
    return str.length >= starts.length && str.substring(0, starts.length) === starts;
};

var endsWith = function(str, ends) {
    return str.length >= ends.length && str.substring(str.length - ends.length) === ends;
};

_.extend(LivedataTest.ClientStream.prototype, {
    on: function(name, callback) {
        var self = this;
        if ("message" !== name && "reset" !== name && "disconnect" !== name) throw new Error("unknown event type: " + name);
        self.eventCallbacks[name] || (self.eventCallbacks[name] = []);
        self.eventCallbacks[name].push(callback);
    },
    _initCommon: function() {
        var self = this;
        self.CONNECT_TIMEOUT = 1e4;
        self.eventCallbacks = {};
        self._forcedToDisconnect = false;
        self.currentStatus = {
            status: "connecting",
            connected: false,
            retryCount: 0
        };
        self.statusListeners = "undefined" != typeof Deps && new Deps.Dependency();
        self.statusChanged = function() {
            self.statusListeners && self.statusListeners.changed();
        };
        self._retry = new Retry();
        self.connectionTimer = null;
    },
    reconnect: function(options) {
        var self = this;
        options = options || {};
        options.url && self._changeUrl(options.url);
        options._sockjsOptions && (self.options._sockjsOptions = options._sockjsOptions);
        if (self.currentStatus.connected) {
            (options._force || options.url) && self._lostConnection();
            return;
        }
        "connecting" === self.currentStatus.status && self._lostConnection();
        self._retry.clear();
        self.currentStatus.retryCount -= 1;
        self._retryNow();
    },
    disconnect: function(options) {
        var self = this;
        options = options || {};
        if (self._forcedToDisconnect) return;
        options._permanent && (self._forcedToDisconnect = true);
        self._cleanup();
        self._retry.clear();
        self.currentStatus = {
            status: options._permanent ? "failed" : "offline",
            connected: false,
            retryCount: 0
        };
        options._permanent && options._error && (self.currentStatus.reason = options._error);
        self.statusChanged();
    },
    _lostConnection: function() {
        var self = this;
        self._cleanup();
        self._retryLater();
    },
    _online: function() {
        "offline" != this.currentStatus.status && this.reconnect();
    },
    _retryLater: function() {
        var self = this;
        var timeout = 0;
        self.options.retry && (timeout = self._retry.retryLater(self.currentStatus.retryCount, _.bind(self._retryNow, self)));
        self.currentStatus.status = "waiting";
        self.currentStatus.connected = false;
        self.currentStatus.retryTime = new Date().getTime() + timeout;
        self.statusChanged();
    },
    _retryNow: function() {
        var self = this;
        if (self._forcedToDisconnect) return;
        self.currentStatus.retryCount += 1;
        self.currentStatus.status = "connecting";
        self.currentStatus.connected = false;
        delete self.currentStatus.retryTime;
        self.statusChanged();
        self._launchConnection();
    },
    status: function() {
        var self = this;
        self.statusListeners && self.statusListeners.depend();
        return self.currentStatus;
    }
});

RandomStream = function(options) {
    this.seed = [].concat(options.seed || randomToken());
    this.sequences = {};
};

RandomStream.get = function(scope, name) {
    name || (name = "default");
    if (!scope) return Random;
    var randomStream = scope.randomStream;
    randomStream || (scope.randomStream = randomStream = new RandomStream({
        seed: scope.randomSeed
    }));
    return randomStream._sequence(name);
};

DDP.randomStream = function(name) {
    var scope = DDP._CurrentInvocation.get();
    return RandomStream.get(scope, name);
};

makeRpcSeed = function(enclosing, methodName) {
    var stream = RandomStream.get(enclosing, "/rpc/" + methodName);
    return stream.hexString(20);
};

_.extend(RandomStream.prototype, {
    _sequence: function(name) {
        var self = this;
        var sequence = self.sequences[name] || null;
        if (null === sequence) {
            var sequenceSeed = self.seed.concat(name);
            for (var i = 0; sequenceSeed.length > i; i++) _.isFunction(sequenceSeed[i]) && (sequenceSeed[i] = sequenceSeed[i]());
            self.sequences[name] = sequence = Random.createWithSeeds.apply(null, sequenceSeed);
        }
        return sequence;
    }
});

module.exports = {
    DDP: DDP
};