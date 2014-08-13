var modulePath = "ti.meteor/packages/";

var EJSON = require(modulePath + "ejson").EJSON;

var stringify = function(value) {
    if (void 0 === value) return "undefined";
    return EJSON.stringify(value);
};

var parse = function(serialized) {
    if (void 0 === serialized || "undefined" === serialized) return void 0;
    return EJSON.parse(serialized);
};

ReactiveDict = function(migrationData) {
    this.keys = migrationData || {};
    this.keyDeps = {};
    this.keyValueDeps = {};
};

_.extend(ReactiveDict.prototype, {
    set: function(key, value) {
        var self = this;
        value = stringify(value);
        var oldSerializedValue = "undefined";
        _.has(self.keys, key) && (oldSerializedValue = self.keys[key]);
        if (value === oldSerializedValue) return;
        self.keys[key] = value;
        var changed = function(v) {
            v && v.changed();
        };
        changed(self.keyDeps[key]);
        if (self.keyValueDeps[key]) {
            changed(self.keyValueDeps[key][oldSerializedValue]);
            changed(self.keyValueDeps[key][value]);
        }
    },
    setDefault: function(key, value) {
        var self = this;
        void 0 === self.keys[key] && self.set(key, value);
    },
    get: function(key) {
        var self = this;
        self._ensureKey(key);
        self.keyDeps[key].depend();
        return parse(self.keys[key]);
    },
    equals: function(key, value) {
        var self = this;
        var ObjectID = Package["mongo-livedata"] && Meteor.Collection.ObjectID;
        if (!("string" == typeof value || "number" == typeof value || "boolean" == typeof value || "undefined" == typeof value || value instanceof Date || ObjectID && value instanceof ObjectID || null === value)) throw new Error("ReactiveDict.equals: value must be scalar");
        var serializedValue = stringify(value);
        if (Deps.active) {
            self._ensureKey(key);
            _.has(self.keyValueDeps[key], serializedValue) || (self.keyValueDeps[key][serializedValue] = new Deps.Dependency());
            var isNew = self.keyValueDeps[key][serializedValue].depend();
            isNew && Deps.onInvalidate(function() {
                self.keyValueDeps[key][serializedValue].hasDependents() || delete self.keyValueDeps[key][serializedValue];
            });
        }
        var oldValue = void 0;
        _.has(self.keys, key) && (oldValue = parse(self.keys[key]));
        return EJSON.equals(oldValue, value);
    },
    _ensureKey: function(key) {
        var self = this;
        if (!(key in self.keyDeps)) {
            self.keyDeps[key] = new Deps.Dependency();
            self.keyValueDeps[key] = {};
        }
    },
    getMigrationData: function() {
        return this.keys;
    }
});

exports.ReactiveDict = ReactiveDict;