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