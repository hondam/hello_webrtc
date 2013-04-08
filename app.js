
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , WebSocketServer = require('ws').Server
  , wsClients = [];

var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(require('less-middleware')({ src: __dirname + '/public' }));
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

app.get('/', routes.index);
app.get('/users', user.list);

var server = http.createServer(app);
server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var wss = new WebSocketServer({server: server});
wss.on('connection', function(ws) {
  console.log("[DEBUG] connect");

  ws.id = id();
  console.log("[DEBUG] new socket get id: " + ws.id);

  wsClients.push(ws);

  ws.on('message', function(data) {
    try {
      var mess = JSON.parse(data);
      switch(mess.type) {
        case 'candidate':
        case 'offer':
        case 'answer':
          console.log('[DEBUG] ', ws.id, mess.type);
          sendMessage(mess.type, ws.id, mess);
          break;        
        default:
          console.log('Message unrecognized');
          break;
      }
    } catch(e) {
      throw e;
      console.log('Invalid message', data);
    }
  });

  ws.on('close', function() {
    console.log('[DEBUG] client id: #%d disconnected.', ws.id);
  });

  ws.on('error', function(e) {
    console.log('[DEBUG] client id: #%d error: %s', ws.id, e.message);
  });
});

function sendMessage(type, id, mess) {
  wsClients.forEach(function(ws) {
    if (ws.id === id) {
    } else {
      ws.send(JSON.stringify(mess));
    }
  });
}
function S4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}
function id() {
  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}

