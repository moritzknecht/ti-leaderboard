var lastLoginTokenWhenPolled;

Meteor.loginWithToken = function(token, callback) {
    Accounts.callLoginMethod({
        methodArguments: [ {
            resume: token
        } ],
        userCallback: callback
    });
};

Accounts._enableAutoLogin = function() {
    autoLoginEnabled = true;
    pollStoredLoginToken();
};

var loginTokenKey = "Meteor.loginToken";

var loginTokenExpiresKey = "Meteor.loginTokenExpires";

var userIdKey = "Meteor.userId";

Accounts._isolateLoginTokenForTest = function() {
    loginTokenKey += Random.id();
    userIdKey += Random.id();
};

storeLoginToken = function(userId, token, tokenExpires) {
    Ti.App.Properties.setString(userIdKey, userId);
    Ti.App.Properties.setString(loginTokenKey, token);
    tokenExpires || (tokenExpires = Accounts._tokenExpiration(new Date()));
    Ti.App.Properties.setString(loginTokenExpiresKey, tokenExpires);
    lastLoginTokenWhenPolled = token;
};

unstoreLoginToken = function() {
    Ti.App.Properties.removeProperty(userIdKey);
    Ti.App.Properties.removeProperty(loginTokenKey);
    Ti.App.Properties.removeProperty(loginTokenExpiresKey);
    lastLoginTokenWhenPolled = null;
};

storedLoginToken = Accounts._storedLoginToken = function() {
    return Ti.App.Properties.getString(loginTokenKey);
};

storedLoginTokenExpires = Accounts._storedLoginTokenExpires = function() {
    return Ti.App.Properties.getString(loginTokenExpiresKey);
};

var storedUserId = Accounts._storedUserId = function() {
    return Ti.App.Properties.getString(userIdKey);
};

var unstoreLoginTokenIfExpiresSoon = function() {
    var tokenExpires = Ti.App.Properties.getString(loginTokenExpiresKey);
    tokenExpires && Accounts._tokenExpiresSoon(new Date(tokenExpires)) && unstoreLoginToken();
};

var autoLoginEnabled = true;

if (autoLoginEnabled) {
    unstoreLoginTokenIfExpiresSoon();
    var token = storedLoginToken();
    if (token) {
        var userId = storedUserId();
        userId && Accounts.connection.setUserId(userId);
        Meteor.loginWithToken(token, function(err) {
            if (err) {
                Meteor._debug("Error logging in with token: " + err);
                makeClientLoggedOut();
            }
        });
    }
}

lastLoginTokenWhenPolled = token;

var pollStoredLoginToken = function() {
    if (!autoLoginEnabled) return;
    var currentLoginToken = storedLoginToken();
    lastLoginTokenWhenPolled != currentLoginToken && (currentLoginToken ? Meteor.loginWithToken(currentLoginToken, function(err) {
        err && makeClientLoggedOut();
    }) : Meteor.logout());
    lastLoginTokenWhenPolled = currentLoginToken;
};