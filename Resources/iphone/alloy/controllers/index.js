function __processArg(obj, key) {
    var arg = null;
    if (obj) {
        arg = obj[key] || null;
        delete obj[key];
    }
    return arg;
}

function Controller() {
    function onItemclick(e) {
        console.log("onItemclick: e = " + JSON.stringify(e));
        var id = items[e.itemIndex]._id;
        Players.update(id, {
            $inc: {
                score: 5
            }
        });
    }
    require("alloy/controllers/BaseController").apply(this, Array.prototype.slice.call(arguments));
    this.__controllerPath = "index";
    if (arguments[0]) {
        __processArg(arguments[0], "__parentSymbol");
        __processArg(arguments[0], "$model");
        __processArg(arguments[0], "__itemTemplate");
    }
    var $ = this;
    var exports = {};
    var __defers = {};
    $.__views.__alloyId0 = Ti.UI.createWindow({
        statusBarStyle: Titanium.UI.iPhone.StatusBar.LIGHT_CONTENT,
        title: "Leaderboard",
        id: "__alloyId0"
    });
    var __alloyId1 = {};
    var __alloyId4 = [];
    var __alloyId5 = {
        type: "Ti.UI.Label",
        bindId: "name",
        properties: {
            left: 25,
            bindId: "name"
        }
    };
    __alloyId4.push(__alloyId5);
    var __alloyId6 = {
        type: "Ti.UI.Label",
        bindId: "score",
        properties: {
            right: 20,
            font: {
                fontWeight: "bold"
            },
            bindId: "score"
        }
    };
    __alloyId4.push(__alloyId6);
    var __alloyId3 = {
        properties: {
            name: "player"
        },
        childTemplates: __alloyId4
    };
    __alloyId1["player"] = __alloyId3;
    $.__views.players = Ti.UI.createListSection({
        id: "players"
    });
    var __alloyId8 = [];
    __alloyId8.push($.__views.players);
    $.__views.list = Ti.UI.createListView({
        sections: __alloyId8,
        templates: __alloyId1,
        id: "list"
    });
    $.__views.__alloyId0.add($.__views.list);
    onItemclick ? $.__views.list.addEventListener("itemclick", onItemclick) : __defers["$.__views.list!itemclick!onItemclick"] = true;
    $.__views.index = Ti.UI.iOS.createNavigationWindow({
        window: $.__views.__alloyId0,
        id: "index"
    });
    $.__views.index && $.addTopLevelView($.__views.index);
    exports.destroy = function() {};
    _.extend($, $.__views);
    var Players = new Meteor.Collection("players");
    var items = [];
    Deps.autorun(function() {
        items = [];
        var players = Players.find({}, {
            sort: {
                score: -1
            }
        }, {
            limit: 1
        }).fetch();
        _.each(players, function(player) {
            items.push({
                template: "player",
                name: {
                    text: player.name
                },
                score: {
                    text: player.score
                },
                _id: player._id
            });
        });
        $.players.setItems(items);
        $.list.setSections([ $.players ]);
    });
    Meteor.subscribe("players");
    $.index.open();
    __defers["$.__views.list!itemclick!onItemclick"] && $.__views.list.addEventListener("itemclick", onItemclick);
    _.extend($, exports);
}

var Alloy = require("alloy"), Backbone = Alloy.Backbone, _ = Alloy._;

module.exports = Controller;