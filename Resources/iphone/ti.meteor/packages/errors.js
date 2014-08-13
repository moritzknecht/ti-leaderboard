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