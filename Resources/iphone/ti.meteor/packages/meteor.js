var Meteor;

(function() {
    Meteor = {
        isClient: true,
        isServer: false
    };
}).call(this);

(function() {
    _.extend(Meteor, {
        _get: function(obj) {
            for (var i = 1; arguments.length > i; i++) {
                if (!(arguments[i] in obj)) return void 0;
                obj = obj[arguments[i]];
            }
            return obj;
        },
        _ensure: function(obj) {
            for (var i = 1; arguments.length > i; i++) {
                var key = arguments[i];
                key in obj || (obj[key] = {});
                obj = obj[key];
            }
            return obj;
        },
        _delete: function(obj) {
            var stack = [ obj ];
            var leaf = true;
            for (var i = 1; arguments.length - 1 > i; i++) {
                var key = arguments[i];
                if (!(key in obj)) {
                    leaf = false;
                    break;
                }
                obj = obj[key];
                if ("object" != typeof obj) break;
                stack.push(obj);
            }
            for (var i = stack.length - 1; i >= 0; i--) {
                var key = arguments[i + 1];
                if (leaf) leaf = false; else for (var other in stack[i][key]) return;
                delete stack[i][key];
            }
        },
        _wrapAsync: function(fn) {
            return function() {
                var self = this;
                var callback;
                var fut;
                var newArgs = _.toArray(arguments);
                var logErr = function(err) {
                    if (err) return Meteor._debug("Exception in callback of async function", err.stack ? err.stack : err);
                };
                while (newArgs.length > 0 && "undefined" == typeof newArgs[newArgs.length - 1]) newArgs.pop();
                if (newArgs.length > 0 && newArgs[newArgs.length - 1] instanceof Function) callback = newArgs.pop(); else if (Meteor.isClient) callback = logErr; else {
                    fut = new Future();
                    callback = fut.resolver();
                }
                newArgs.push(Meteor.bindEnvironment(callback));
                var result = fn.apply(self, newArgs);
                if (fut) return fut.wait();
                return result;
            };
        },
        _inherits: function(Child, Parent) {
            for (var key in Parent) _.has(Parent, key) && (Child[key] = Parent[key]);
            var Middle = function() {
                this.constructor = Child;
            };
            Middle.prototype = Parent.prototype;
            Child.prototype = new Middle();
            Child.__super__ = Parent.prototype;
            return Child;
        }
    });
}).call(this);

(function() {
    "use strict";
    function useSetImmediate() {
        if (global.setImmediate) {
            var setImmediate = function(fn) {
                global.setImmediate(fn);
            };
            setImmediate.implementation = "setImmediate";
            return setImmediate;
        }
        return null;
    }
    function usePostMessage() {
        function isStringAndStartsWith(string, putativeStart) {
            return "string" == typeof string && string.substring(0, putativeStart.length) === putativeStart;
        }
        function onGlobalMessage(event) {
            if (event.source === global && isStringAndStartsWith(event.data, MESSAGE_PREFIX)) {
                var index = event.data.substring(MESSAGE_PREFIX.length);
                try {
                    funcs[index] && funcs[index]();
                } finally {
                    delete funcs[index];
                }
            }
        }
        if (!global.postMessage || global.importScripts) return null;
        var postMessageIsAsynchronous = true;
        var oldOnMessage = global.onmessage;
        global.onmessage = function() {
            postMessageIsAsynchronous = false;
        };
        global.postMessage("", "*");
        global.onmessage = oldOnMessage;
        if (!postMessageIsAsynchronous) return null;
        var funcIndex = 0;
        var funcs = {};
        var MESSAGE_PREFIX = "Meteor._setImmediate." + Math.random() + ".";
        global.addEventListener ? global.addEventListener("message", onGlobalMessage, false) : global.attachEvent("onmessage", onGlobalMessage);
        var setImmediate = function(fn) {
            ++funcIndex;
            funcs[funcIndex] = fn;
            global.postMessage(MESSAGE_PREFIX + funcIndex, "*");
        };
        setImmediate.implementation = "postMessage";
        return setImmediate;
    }
    function useTimeout() {
        var setImmediate = function(fn) {
            global.setTimeout(fn, 0);
        };
        setImmediate.implementation = "setTimeout";
        return setImmediate;
    }
    var global = this;
    Meteor._setImmediate = useSetImmediate() || usePostMessage() || useTimeout();
}).call(this);

(function() {
    var withoutInvocation = function(f) {
        if (Package.livedata) {
            var _CurrentInvocation = Package.livedata.DDP._CurrentInvocation;
            if (_CurrentInvocation.get() && _CurrentInvocation.get().isSimulation) throw new Error("Can't set timers inside simulations");
            return function() {
                _CurrentInvocation.withValue(null, f);
            };
        }
        return f;
    };
    var bindAndCatch = function(context, f) {
        return Meteor.bindEnvironment(withoutInvocation(f), context);
    };
    _.extend(Meteor, {
        setTimeout: function(f, duration) {
            return setTimeout(bindAndCatch("setTimeout callback", f), duration);
        },
        setInterval: function(f, duration) {
            return setInterval(bindAndCatch("setInterval callback", f), duration);
        },
        clearInterval: function(x) {
            return clearInterval(x);
        },
        clearTimeout: function(x) {
            return clearTimeout(x);
        },
        defer: function(f) {
            Meteor._setImmediate(bindAndCatch("defer callback", f));
        }
    });
}).call(this);

(function() {
    Meteor.makeErrorType = function(name, constructor) {
        var errorClass = function() {
            var self = this;
            if (Error.captureStackTrace) Error.captureStackTrace(self, errorClass); else {
                var e = new Error();
                e.__proto__ = errorClass.prototype;
                e instanceof errorClass && (self = e);
            }
            constructor.apply(self, arguments);
            self.errorType = name;
            return self;
        };
        Meteor._inherits(errorClass, Error);
        return errorClass;
    };
    Meteor.Error = Meteor.makeErrorType("Meteor.Error", function(error, reason, details) {
        var self = this;
        self.error = error;
        self.reason = reason;
        self.details = details;
        self.message = self.reason ? self.reason + " [" + self.error + "]" : "[" + self.error + "]";
    });
    Meteor.Error.prototype.clone = function() {
        var self = this;
        return new Meteor.Error(self.error, self.reason, self.details);
    };
}).call(this);

(function() {
    Meteor._noYieldsAllowed = function(f) {
        return f();
    };
    Meteor._SynchronousQueue = function() {
        var self = this;
        self._tasks = [];
        self._running = false;
    };
    _.extend(Meteor._SynchronousQueue.prototype, {
        runTask: function(task) {
            var self = this;
            if (!self.safeToRunTask()) throw new Error("Could not synchronously run a task from a running task");
            self._tasks.push(task);
            var tasks = self._tasks;
            self._tasks = [];
            self._running = true;
            try {
                while (!_.isEmpty(tasks)) {
                    var t = tasks.shift();
                    try {
                        t();
                    } catch (e) {
                        if (_.isEmpty(tasks)) throw e;
                        Meteor._debug("Exception in queued task: " + e.stack);
                    }
                }
            } finally {
                self._running = false;
            }
        },
        queueTask: function(task) {
            var self = this;
            var wasEmpty = _.isEmpty(self._tasks);
            self._tasks.push(task);
            wasEmpty && setTimeout(_.bind(self.flush, self), 0);
        },
        flush: function() {
            var self = this;
            self.runTask(function() {});
        },
        drain: function() {
            var self = this;
            if (!self.safeToRunTask()) return;
            while (!_.isEmpty(self._tasks)) self.flush();
        },
        safeToRunTask: function() {
            var self = this;
            return !self._running;
        }
    });
}).call(this);

(function() {
    var suppress = 0;
    Meteor._debug = function() {
        if (suppress) {
            suppress--;
            return;
        }
        if ("undefined" != typeof console && "undefined" != typeof console.log) if (0 == arguments.length) console.log(""); else if ("function" == typeof console.log.apply) {
            var allArgumentsOfTypeString = true;
            for (var i = 0; arguments.length > i; i++) "string" != typeof arguments[i] && (allArgumentsOfTypeString = false);
            allArgumentsOfTypeString ? console.log.apply(console, [ Array.prototype.join.call(arguments, " ") ]) : console.log.apply(console, arguments);
        } else if ("function" == typeof Function.prototype.bind) {
            var log = Function.prototype.bind.call(console.log, console);
            log.apply(console, arguments);
        } else Function.prototype.call.call(console.log, console, Array.prototype.slice.call(arguments));
    };
    Meteor._suppress_log = function(count) {
        suppress += count;
    };
}).call(this);

(function() {
    var nextSlot = 0;
    var currentValues = [];
    Meteor.EnvironmentVariable = function() {
        this.slot = nextSlot++;
    };
    _.extend(Meteor.EnvironmentVariable.prototype, {
        get: function() {
            return currentValues[this.slot];
        },
        getOrNullIfOutsideFiber: function() {
            return this.get();
        },
        withValue: function(value, func) {
            var saved = currentValues[this.slot];
            try {
                currentValues[this.slot] = value;
                var ret = func();
            } finally {
                currentValues[this.slot] = saved;
            }
            return ret;
        }
    });
    Meteor.bindEnvironment = function(func, onException, _this) {
        var boundValues = _.clone(currentValues);
        if (!onException || "string" == typeof onException) {
            var description = onException || "callback of async function";
            onException = function(error) {
                Meteor._debug("Exception in " + description + ":", error && error.stack || error);
            };
        }
        return function() {
            var savedValues = currentValues;
            try {
                currentValues = boundValues;
                var ret = func.apply(_this, _.toArray(arguments));
            } catch (e) {
                onException(e);
            } finally {
                currentValues = savedValues;
            }
            return ret;
        };
    };
    Meteor._nodeCodeMustBeInFiber = function() {};
    module.exports = {
        Meteor: Meteor
    };
}).call(this);