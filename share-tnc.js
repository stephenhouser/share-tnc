#! /usr/bin/env node

/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

/*
  This is a command-line utility to share out a serial port TNC to one or more
  KISS-TCP client programs.

  For instance, you could have a serial TNC shared between APRX and a client
  program like APRSIS32.
*/
var path=require('path');
var util=require('util');
var ServerSocketKISSFrameEndpoint=
  require('utils-for-aprs').ServerSocketKISSFrameEndpoint;
var SerialKISSFrameEndpoint=require('utils-for-aprs').SerialKISSFrameEndpoint;
var SocketKISSFrameEndpoint=require('utils-for-aprs').SocketKISSFrameEndpoint;

var opt=require('node-getopt').create([
  ['', 'baud[=BAUD]', 'baud rate']
]).bindHelp().parseSystem();

if (opt.argv.length != 2) {
  console.log("Usage: share-tnc <device> <port> --baud=BAUD");
  return;
}

/*
  The pipeline is sort of like this:
    SerialKISSFrameEndpoint Endpoint -> sharePortToTCP -> ServerSocketKISSFrameEndpoint
*/

var device=opt.argv[0];
var port=opt.argv[1];
var baud= opt.options.baud?parseInt(opt.options.baud):1200

//Create the server socket endpoint
var serverEndpoint=new ServerSocketKISSFrameEndpoint("0.0.0.0", port);

var targetEndpoint=null;

// If the device happens to look like "host:port" then create a socket endpoint.
var res=/([^\:]+):([0-9]+)/.exec(device);
if (res) {
  var host=res[1];
  var port=res[2];
  targetEndpoint=new SocketKISSFrameEndpoint();
  targetEndpoint.host=host;
  targetEndpoint.port=port;
} else {
  targetEndpoint=new SerialKISSFrameEndpoint(device, {baudrate: baud});
}


/* All connections are put into a Set, which lets us use forEach()
*/
var allConnections=new Set();

// Log interesting events...
serverEndpoint.on('connect', function(connection) {
  console.log("TCP Endpoint received a connection from " +
    connection.socket.remoteAddress + ":" + connection.socket.remotePort);
  allConnections.add(connection);
  connection.on('data', function(frame) {
    relayToAllBut(connection,frame);
  });
  connection.on('close', function() {
    allConnections.delete(connection);
    console.log("TCP connection from " +
      connection.socket.remoteAddress + ":" + connection.socket.remotePort +
      " was closed");
  });
});

serverEndpoint.on('listen', function() {
  console.log("KISS TCP server established - listening for connections on port " + [port]);
});

serverEndpoint.on('error', function(err) {
  console.log("Error on server endpoint:" + err);
});

targetEndpoint.on('error', function(err) {
  console.log("Error on serial TNC endpoint:" + err);
});

targetEndpoint.on('connect', function(connection) {
  console.log("Connected to TNC on " + device + (res?"":" at " + baud + " baud."));
  allConnections.add(connection);
  connection.on('data', function(frame) {
    relayToAllBut(connection, frame);
  });
  connection.on('disconnect', function() {
    allConnections.delete(connection);
    console.log('TNC connection was closed');
  });
});

var relayToAllBut=function(source, frame) {
  //console.log("Got frame from " + source);
  allConnections.forEach(function(connection){
    if (connection === source) {
      //console.log("Skipping destination " + connection);
    } else {
      connection.data(frame);
    }
  });
}

/* Turn on the endpoints.
  - Target Endpoint will attempt to connect to TNC
  - ServerSocketKISSFrameEndpoint will open the server port and start
  accepting connections
*/
targetEndpoint.enable();
serverEndpoint.enable();
