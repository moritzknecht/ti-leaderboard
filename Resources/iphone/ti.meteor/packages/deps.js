(function() {
    var Deps;
    (function() {
        Deps = {};
        Deps.active = false;
        Deps.currentComputation = null;
        var setCurrentComputation = function(c) {
            Deps.currentComputation = c;
            Deps.active = !!c;
        };
        var _debugFunc = function() {
            return "undefined" != typeof Meteor ? Meteor._debug : "undefined" != typeof console && console.log ? function() {
                console.log.apply(console, arguments);
            } : function() {};
        };
        var _throwOrLog = function(from, e) {
            if (throwFirstError) throw e;
            _debugFunc()("Exception from Deps " + from + " function:", e.stack || e.message);
        };
        var withNoYieldsAllowed = function(f) {
            return "undefined" == typeof Meteor || Meteor.isClient ? f : function() {
                var args = arguments;
                Meteor._noYieldsAllowed(function() {
                    f.apply(null, args);
                });
            };
        };
        var nextId = 1;
        var pendingComputations = [];
        var willFlush = false;
        var inFlush = false;
        var inCompute = false;
        var throwFirstError = false;
        var afterFlushCallbacks = [];
        var requireFlush = function() {
            if (!willFlush) {
                setTimeout(Deps.flush, 0);
                willFlush = true;
            }
        };
        var constructingComputation = false;
        Deps.Computation = function(f, parent) {
            if (!constructingComputation) throw new Error("Deps.Computation constructor is private; use Deps.autorun");
            constructingComputation = false;
            var self = this;
            self.stopped = false;
            self.invalidated = false;
            self.firstRun = true;
            self._id = nextId++;
            self._onInvalidateCallbacks = [];
            self._parent = parent;
            self._func = f;
            self._recomputing = false;
            var errored = true;
            try {
                self._compute();
                errored = false;
            } finally {
                self.firstRun = false;
                errored && self.stop();
            }
        };
        Deps.Computation.prototype.onInvalidate = function(f) {
            var self = this;
            if ("function" != typeof f) throw new Error("onInvalidate requires a function");
            self.invalidated ? Deps.nonreactive(function() {
                withNoYieldsAllowed(f)(self);
            }) : self._onInvalidateCallbacks.push(f);
        };
        Deps.Computation.prototype.invalidate = function() {
            var self = this;
            if (!self.invalidated) {
                if (!self._recomputing && !self.stopped) {
                    requireFlush();
                    pendingComputations.push(this);
                }
                self.invalidated = true;
                for (var f, i = 0; f = self._onInvalidateCallbacks[i]; i++) Deps.nonreactive(function() {
                    withNoYieldsAllowed(f)(self);
                });
                self._onInvalidateCallbacks = [];
            }
        };
        Deps.Computation.prototype.stop = function() {
            if (!this.stopped) {
                this.stopped = true;
                this.invalidate();
            }
        };
        Deps.Computation.prototype._compute = function() {
            var self = this;
            self.invalidated = false;
            var previous = Deps.currentComputation;
            setCurrentComputation(self);
            inCompute = true;
            try {
                withNoYieldsAllowed(self._func)(self);
            } finally {
                setCurrentComputation(previous);
                inCompute = false;
            }
        };
        Deps.Computation.prototype._recompute = function() {
            var self = this;
            self._recomputing = true;
            try {
                while (self.invalidated && !self.stopped) try {
                    self._compute();
                } catch (e) {
                    _throwOrLog("recompute", e);
                }
            } finally {
                self._recomputing = false;
            }
        };
        Deps.Dependency = function() {
            this._dependentsById = {};
        };
        Deps.Dependency.prototype.depend = function(computation) {
            if (!computation) {
                if (!Deps.active) return false;
                computation = Deps.currentComputation;
            }
            var self = this;
            var id = computation._id;
            if (!(id in self._dependentsById)) {
                self._dependentsById[id] = computation;
                computation.onInvalidate(function() {
                    delete self._dependentsById[id];
                });
                return true;
            }
            return false;
        };
        Deps.Dependency.prototype.changed = function() {
            var self = this;
            for (var id in self._dependentsById) self._dependentsById[id].invalidate();
        };
        Deps.Dependency.prototype.hasDependents = function() {
            var self = this;
            for (var id in self._dependentsById) return true;
            return false;
        };
        Deps.flush = function(_opts) {
            if (inFlush) throw new Error("Can't call Deps.flush while flushing");
            if (inCompute) throw new Error("Can't flush inside Deps.autorun");
            inFlush = true;
            willFlush = true;
            throwFirstError = !!(_opts && _opts._throwFirstError);
            var finishedTry = false;
            try {
                while (pendingComputations.length || afterFlushCallbacks.length) {
                    while (pendingComputations.length) {
                        var comp = pendingComputations.shift();
                        comp._recompute();
                    }
                    if (afterFlushCallbacks.length) {
                        var func = afterFlushCallbacks.shift();
                        try {
                            func();
                        } catch (e) {
                            _throwOrLog("afterFlush function", e);
                        }
                    }
                }
                finishedTry = true;
            } finally {
                if (!finishedTry) {
                    inFlush = false;
                    Deps.flush({
                        _throwFirstError: false
                    });
                }
                willFlush = false;
                inFlush = false;
            }
        };
        Deps.autorun = function(f) {
            if ("function" != typeof f) throw new Error("Deps.autorun requires a function argument");
            constructingComputation = true;
            var c = new Deps.Computation(f, Deps.currentComputation);
            Deps.active && Deps.onInvalidate(function() {
                c.stop();
            });
            return c;
        };
        Deps.nonreactive = function(f) {
            var previous = Deps.currentComputation;
            setCurrentComputation(null);
            try {
                return f();
            } finally {
                setCurrentComputation(previous);
            }
        };
        Deps.onInvalidate = function(f) {
            if (!Deps.active) throw new Error("Deps.onInvalidate requires a currentComputation");
            Deps.currentComputation.onInvalidate(f);
        };
        Deps.afterFlush = function(f) {
            afterFlushCallbacks.push(f);
            requireFlush();
        };
    }).call(this);
    (function() {
        Meteor.flush = Deps.flush;
        Meteor.autorun = Deps.autorun;
        Meteor.autosubscribe = Deps.autorun;
        Deps.depend = function(d) {
            return d.depend();
        };
    }).call(this);
    exports.Deps = Deps;
})();