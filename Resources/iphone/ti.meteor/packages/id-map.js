exports.IdMap = IdMap = function(idStringify, idParse) {
    var self = this;
    self._map = {};
    self._idStringify = idStringify || JSON.stringify;
    self._idParse = idParse || JSON.parse;
};

_.extend(IdMap.prototype, {
    get: function(id) {
        var self = this;
        var key = self._idStringify(id);
        return self._map[key];
    },
    set: function(id, value) {
        var self = this;
        var key = self._idStringify(id);
        self._map[key] = value;
    },
    remove: function(id) {
        var self = this;
        var key = self._idStringify(id);
        delete self._map[key];
    },
    has: function(id) {
        var self = this;
        var key = self._idStringify(id);
        return _.has(self._map, key);
    },
    empty: function() {
        var self = this;
        return _.isEmpty(self._map);
    },
    clear: function() {
        var self = this;
        self._map = {};
    },
    forEach: function(iterator) {
        var self = this;
        var keys = _.keys(self._map);
        for (var i = 0; keys.length > i; i++) {
            var breakIfFalse = iterator.call(null, self._map[keys[i]], self._idParse(keys[i]));
            if (false === breakIfFalse) return;
        }
    },
    size: function() {
        var self = this;
        return _.size(self._map);
    },
    setDefault: function(id, def) {
        var self = this;
        var key = self._idStringify(id);
        if (_.has(self._map, key)) return self._map[key];
        self._map[key] = def;
        return def;
    },
    clone: function() {
        var self = this;
        var clone = new IdMap(self._idStringify, self._idParse);
        self.forEach(function(value, id) {
            clone.set(id, EJSON.clone(value));
        });
        return clone;
    }
});