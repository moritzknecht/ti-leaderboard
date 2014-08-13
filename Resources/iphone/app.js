var Alloy = require("alloy"), _ = Alloy._, Backbone = Alloy.Backbone;

var TiMeteor = require("ti.meteor/meteor");

_ = TiMeteor._;

Meteor = TiMeteor.Meteor;

Package = TiMeteor.Package;

Deps = TiMeteor.Deps;

Session = TiMeteor.Session;

Accounts = TiMeteor.Accounts;

TiMeteor.WebView = require("ti.meteor/plugins/webview");

TiMeteor.init({
    host: "192.168.0.70",
    port: 3e3,
    use_ssl: false
});

Alloy.createController("index");