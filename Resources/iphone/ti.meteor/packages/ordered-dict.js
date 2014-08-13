var element = function(key, value, next, prev) {
    return {
        key: key,
        value: value,
        next: next,
        prev: prev
    };
};

OrderedDict = function() {
    var self = this;
    self._dict = {};
    self._first = null;
    self._last = null;
    self._size = 0;
    var args = _.toArray(arguments);
    self._stringify = function(x) {
        return x;
    };
    "function" == typeof args[0] && (self._stringify = args.shift());
    _.each(args, function(kv) {
        self.putBefore(kv[0], kv[1], null);
    });
};

_.extend(OrderedDict.prototype, {
    _k: function(key) {
        return " " + this._stringify(key);
    },
    empty: function() {
        var self = this;
        return !self._first;
    },
    size: function() {
        var self = this;
        return self._size;
    },
    _linkEltIn: function(elt) {
        var self = this;
        if (elt.next) {
            elt.prev = elt.next.prev;
            elt.next.prev = elt;
            elt.prev && (elt.prev.next = elt);
        } else {
            elt.prev = self._last;
            self._last && (self._last.next = elt);
            self._last = elt;
        }
        (null === self._first || self._first === elt.next) && (self._first = elt);
    },
    _linkEltOut: function(elt) {
        var self = this;
        elt.next && (elt.next.prev = elt.prev);
        elt.prev && (elt.prev.next = elt.next);
        elt === self._last && (self._last = elt.prev);
        elt === self._first && (self._first = elt.next);
    },
    putBefore: function(key, item, before) {
        var self = this;
        if (self._dict[self._k(key)]) throw new Error("Item " + key + " already present in OrderedDict");
        var elt = before ? element(key, item, self._dict[self._k(before)]) : element(key, item, null);
        if (void 0 === elt.next) throw new Error("could not find item to put this one before");
        self._linkEltIn(elt);
        self._dict[self._k(key)] = elt;
        self._size++;
    },
    append: function(key, item) {
        var self = this;
        self.putBefore(key, item, null);
    },
    remove: function(key) {
        var self = this;
        var elt = self._dict[self._k(key)];
        if (void 0 === elt) throw new Error("Item " + key + " not present in OrderedDict");
        self._linkEltOut(elt);
        self._size--;
        delete self._dict[self._k(key)];
        return elt.value;
    },
    get: function(key) {
        var self = this;
        if (self.has(key)) return self._dict[self._k(key)].value;
        return void 0;
    },
    has: function(key) {
        var self = this;
        return _.has(self._dict, self._k(key));
    },
    forEach: function(iter) {
        var self = this;
        var i = 0;
        var elt = self._first;
        while (null !== elt) {
            var b = iter(elt.value, elt.key, i);
            if (b === OrderedDict.BREAK) return;
            elt = elt.next;
            i++;
        }
    },
    first: function() {
        var self = this;
        if (self.empty()) return void 0;
        return self._first.key;
    },
    firstValue: function() {
        var self = this;
        if (self.empty()) return void 0;
        return self._first.value;
    },
    last: function() {
        var self = this;
        if (self.empty()) return void 0;
        return self._last.key;
    },
    lastValue: function() {
        var self = this;
        if (self.empty()) return void 0;
        return self._last.value;
    },
    prev: function(key) {
        var self = this;
        if (self.has(key)) {
            var elt = self._dict[self._k(key)];
            if (elt.prev) return elt.prev.key;
        }
        return null;
    },
    next: function(key) {
        var self = this;
        if (self.has(key)) {
            var elt = self._dict[self._k(key)];
            if (elt.next) return elt.next.key;
        }
        return null;
    },
    moveBefore: function(key, before) {
        var self = this;
        var elt = self._dict[self._k(key)];
        var eltBefore = before ? self._dict[self._k(before)] : null;
        if (void 0 === elt) throw new Error("Item to move is not present");
        if (void 0 === eltBefore) throw new Error("Could not find element to move this one before");
        if (eltBefore === elt.next) return;
        self._linkEltOut(elt);
        elt.next = eltBefore;
        self._linkEltIn(elt);
    },
    indexOf: function(key) {
        var self = this;
        var ret = null;
        self.forEach(function(v, k, i) {
            if (self._k(k) === self._k(key)) {
                ret = i;
                return OrderedDict.BREAK;
            }
            return void 0;
        });
        return ret;
    },
    _checkRep: function() {
        var self = this;
        _.each(self._dict, function(k, v) {
            if (v.next === v) throw new Error("Next is a loop");
            if (v.prev === v) throw new Error("Prev is a loop");
        });
    }
});

OrderedDict.BREAK = {
    "break": true
};

exports.OrderedDict = OrderedDict;