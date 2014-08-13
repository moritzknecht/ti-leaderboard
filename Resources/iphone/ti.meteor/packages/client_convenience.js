module.exports = function(options) {
    Meteor.refresh = function() {};
    var retry = new Retry();
    var onDDPVersionNegotiationFailure = function(description) {
        Meteor._debug(description);
        if (Package.reload) {
            var migrationData = Package.reload.Reload._migrationData("livedata") || {};
            var failures = migrationData.DDPVersionNegotiationFailures || 0;
            ++failures;
            Package.reload.Reload._onMigrate("livedata", function() {
                return [ true, {
                    DDPVersionNegotiationFailures: failures
                } ];
            });
            retry.retryLater(failures, function() {
                Package.reload.Reload._reload();
            });
        }
    };
    Meteor.connection = DDP.connect(options, {
        onDDPVersionNegotiationFailure: onDDPVersionNegotiationFailure
    });
    _.each([ "subscribe", "methods", "call", "apply", "status", "reconnect", "disconnect" ], function(name) {
        Meteor[name] = _.bind(Meteor.connection[name], Meteor.connection);
    });
    Meteor.default_connection = Meteor.connection;
    Meteor.connect = DDP.connect;
};